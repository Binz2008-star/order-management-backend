// Rate limiting store - no database transactions needed (Redis operations are atomic)
import { NextRequest } from 'next/server'
import { logger } from './logger'

export type RateLimitFailurePolicy = 'fail-closed' | 'degrade-memory'

export interface RateLimitCheckResult {
  allowed: boolean
  remaining: number
  resetTime: number
}

export interface RateLimitStoreStats {
  count: number
  remaining: number
  resetTime: number
}

export interface RateLimitStore {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitCheckResult>
  resetKey?(key: string): Promise<boolean>
  getStats?(key: string, limit: number, windowMs: number): Promise<RateLimitStoreStats | null>
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyGenerator?: (request: NextRequest) => string
  redisUrl?: string
  redisKeyPrefix?: string
  failurePolicy?: RateLimitFailurePolicy
  store?: RateLimitStore
}

interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode?: 'EX' | 'PX' | 'NX' | 'XX', duration?: number): Promise<string | null>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<boolean>
  del(key: string): Promise<number>
  connect?(): Promise<void>
  multi?(): {
    incr(key: string): void
    expire(key: string, seconds: number): void
    exec(): Promise<[number, boolean] | null>
  }
}

interface UpstashResponse<T> {
  result?: T
  error?: string
}

export type RateLimitResponse =
  | {
    success: true
    headers: Record<string, string>
  }
  | {
    success: false
    headers: Record<string, string>
    statusCode: 429 | 503
    reason: 'limit_exceeded' | 'store_unavailable'
  }

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  return forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'
}

function getRequestPath(request: NextRequest): string {
  const nextUrl = (request as NextRequest & { nextUrl?: { pathname?: string } }).nextUrl
  if (nextUrl?.pathname) return nextUrl.pathname

  try {
    return new URL(request.url).pathname
  } catch {
    return '/'
  }
}

function inferFailurePolicy(prefix?: string): RateLimitFailurePolicy {
  switch (prefix) {
    case 'auth':
    case 'order_creation':
      return 'fail-closed'
    default:
      return 'degrade-memory'
  }
}

function defaultKeyGenerator(config: RateLimitConfig, request: NextRequest): string {
  const ip = getClientIp(request)
  const path = getRequestPath(request)
  const prefix = config.redisKeyPrefix || 'rate_limit'

  switch (prefix) {
    case 'auth':
      return `auth:${ip}:login`
    case 'public_api':
      return `public:${ip}:${path}`
    case 'seller_api':
      return `seller:${ip}:${path}`
    case 'order_creation':
      return `orders:${ip}:create`
    case 'webhooks':
      return `webhooks:${path}`
    default:
      return `${prefix}:${ip}`
  }
}

function buildHeaders(result: RateLimitCheckResult, maxRequests: number, includeRetryAfter: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': maxRequests.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
  }

  if (includeRetryAfter) {
    headers['Retry-After'] = Math.max(0, Math.ceil((result.resetTime - Date.now()) / 1000)).toString()
  }

  return headers
}

class UpstashRestClient implements RedisClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) { }

  private async request<T>(command: string[], method: 'GET' | 'POST' = 'POST'): Promise<T> {
    const encodedCommand = command.map((part) => encodeURIComponent(part)).join('/')
    const url = `${this.baseUrl}/${encodedCommand}`

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Upstash request failed with status ${response.status}`)
    }

    const payload = await response.json() as UpstashResponse<T>

    if (payload.error) {
      throw new Error(payload.error)
    }

    if (typeof payload.result === 'undefined') {
      throw new Error('Upstash response did not include a result')
    }

    return payload.result
  }

  async get(key: string): Promise<string | null> {
    return this.request<string | null>(['get', key], 'GET')
  }

  async set(key: string, value: string, mode?: 'EX' | 'PX' | 'NX' | 'XX', duration?: number): Promise<string | null> {
    const command = ['set', key, value]
    if (mode) command.push(mode)
    if (typeof duration === 'number') command.push(duration.toString())
    return this.request<string | null>(command)
  }

  async incr(key: string): Promise<number> {
    return this.request<number>(['incr', key])
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.request<number>(['expire', key, seconds.toString()])
    return result === 1
  }

  async del(key: string): Promise<number> {
    return this.request<number>(['del', key])
  }

  multi() {
    const commands: string[][] = []

    return {
      incr: (key: string) => {
        commands.push(['incr', key])
      },
      expire: (key: string, seconds: number) => {
        commands.push(['expire', key, seconds.toString()])
      },
      exec: async (): Promise<[number, boolean] | null> => {
        const response = await fetch(`${this.baseUrl}/pipeline`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(commands),
        })

        if (!response.ok) {
          throw new Error(`Upstash pipeline failed with status ${response.status}`)
        }

        const payload = await response.json() as Array<UpstashResponse<number>>

        if (!Array.isArray(payload) || payload.length !== commands.length) {
          throw new Error('Unexpected Upstash pipeline response')
        }

        const results = payload.map((entry) => {
          if (entry.error) {
            throw new Error(entry.error)
          }

          if (typeof entry.result === 'undefined') {
            throw new Error('Upstash pipeline entry missing result')
          }

          return entry.result
        })

        return [results[0], results[1] === 1]
      }
    }
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, { count: number; resetTime: number }>()

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitCheckResult> {
    const now = Date.now()
    let record = this.store.get(key)

    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + windowMs }
      this.store.set(key, record)
    }

    record.count += 1

    return {
      allowed: record.count <= limit,
      remaining: Math.max(0, limit - record.count),
      resetTime: record.resetTime,
    }
  }

  async resetKey(key: string): Promise<boolean> {
    this.store.delete(key)
    return true
  }

  async getStats(key: string, limit: number): Promise<RateLimitStoreStats | null> {
    const record = this.store.get(key)
    if (!record) return null

    return {
      count: record.count,
      remaining: Math.max(0, limit - record.count),
      resetTime: record.resetTime,
    }
  }
}

class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisClient) { }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitCheckResult> {
    if (!this.redis.multi) {
      throw new Error('Redis multi not supported')
    }

    const now = Date.now()
    const pipeline = this.redis.multi()
    pipeline.incr(key)
    pipeline.expire(key, Math.ceil(windowMs / 1000))
    const results = await pipeline.exec()

    if (!results || results.length < 2) {
      throw new Error('Redis pipeline failed')
    }

    const currentCount = (results[0] as unknown as [string, number])[1]

    return {
      allowed: currentCount <= limit,
      remaining: Math.max(0, limit - currentCount),
      resetTime: now + windowMs,
    }
  }

  async resetKey(key: string): Promise<boolean> {
    await this.redis.del(key)
    return true
  }

  async getStats(key: string, limit: number, windowMs: number): Promise<RateLimitStoreStats | null> {
    const value = await this.redis.get(key)
    if (!value) return null

    const count = parseInt(value, 10)
    return {
      count,
      remaining: Math.max(0, limit - count),
      resetTime: Date.now() + windowMs,
    }
  }
}

export class RateLimiter {
  private readonly memoryStore = new MemoryRateLimitStore()
  private primaryStore: RateLimitStore | null = null
  private initPromise: Promise<void> | null = null

  constructor(private readonly config: RateLimitConfig) { }

  private get failurePolicy(): RateLimitFailurePolicy {
    return this.config.failurePolicy ?? inferFailurePolicy(this.config.redisKeyPrefix)
  }

  private getKey(request: NextRequest): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(request)
    }

    return defaultKeyGenerator(this.config, request)
  }

  private async initializeStore(): Promise<void> {
    if (this.config.store) {
      this.primaryStore = this.config.store
      return
    }

    const standardRedisUrl = this.config.redisUrl || process.env.REDIS_URL
    const upstashRestUrl = process.env.UPSTASH_REDIS_REST_URL
    const upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN

    if (standardRedisUrl) {
      const redis = await import('redis')
      const client = redis.createClient({ url: standardRedisUrl }) as unknown as RedisClient
      if (client.connect) {
        await client.connect()
      }
      this.primaryStore = new RedisRateLimitStore(client)
      logger.info('Redis rate limiter initialized successfully', { backend: 'redis' })
      return
    }

    if (upstashRestUrl && upstashRestToken) {
      this.primaryStore = new RedisRateLimitStore(
        new UpstashRestClient(upstashRestUrl.replace(/\/$/, ''), upstashRestToken)
      )
      logger.info('Redis rate limiter initialized successfully', { backend: 'upstash-rest' })
      return
    }

    if (upstashRestUrl && !upstashRestToken) {
      throw new Error('UPSTASH_REDIS_REST_TOKEN is required when UPSTASH_REDIS_REST_URL is configured')
    }
  }

  private async ensureStoreInitialized(): Promise<void> {
    if (this.primaryStore || this.initPromise) {
      await this.initPromise
      return
    }

    this.initPromise = this.initializeStore().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.warn('Primary rate-limit store initialization failed', {
        error: errorMessage,
        failurePolicy: this.failurePolicy,
      })
      this.primaryStore = null
    })

    await this.initPromise
  }

  private shouldFailClosed(): boolean {
    return process.env.NODE_ENV === 'production' && this.failurePolicy === 'fail-closed'
  }

  private async handleStoreFailure(
    key: string,
    error: unknown
  ): Promise<RateLimitCheckResult | null> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (this.shouldFailClosed()) {
      logger.error('Rate limiting store unavailable for fail-closed policy', new Error(errorMessage))
      return null
    }

    logger.warn('Rate limiting store unavailable, degrading to memory fallback', {
      error: errorMessage,
      failurePolicy: this.failurePolicy,
      keyPrefix: this.config.redisKeyPrefix,
    })

    return this.memoryStore.check(key, this.config.maxRequests, this.config.windowMs)
  }

  async isAllowed(request: NextRequest): Promise<RateLimitCheckResult | null> {
    const disableRateLimiting = process.env.DISABLE_RATE_LIMITING === 'true'

    if (disableRateLimiting && (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true')) {
      return {
        allowed: true,
        remaining: Infinity,
        resetTime: Date.now() + 60000,
      }
    }

    const key = this.getKey(request)
    await this.ensureStoreInitialized()

    if (!this.primaryStore) {
      if (this.shouldFailClosed()) {
        logger.error('Rate limiting store unavailable and policy is fail-closed')
        return null
      }

      return this.memoryStore.check(key, this.config.maxRequests, this.config.windowMs)
    }

    try {
      return await this.primaryStore.check(key, this.config.maxRequests, this.config.windowMs)
    } catch (error) {
      return this.handleStoreFailure(key, error)
    }
  }

  async reset(request: NextRequest): Promise<boolean> {
    const key = this.getKey(request)
    await this.ensureStoreInitialized()

    if (this.primaryStore?.resetKey) {
      try {
        return await this.primaryStore.resetKey(key)
      } catch (error) {
        const fallback = await this.handleStoreFailure(key, error)
        if (fallback === null) return false
      }
    }

    return this.memoryStore.resetKey(key)
  }

  async getStats(request: NextRequest): Promise<RateLimitStoreStats | null> {
    const key = this.getKey(request)
    await this.ensureStoreInitialized()

    if (this.primaryStore?.getStats) {
      try {
        return await this.primaryStore.getStats(key, this.config.maxRequests, this.config.windowMs)
      } catch (error) {
        const fallback = await this.handleStoreFailure(key, error)
        if (fallback === null) return null
      }
    }

    return this.memoryStore.getStats(key, this.config.maxRequests)
  }
}

export function createRateLimit(config: RateLimitConfig) {
  const limiter = new RateLimiter(config)

  return async (request: NextRequest): Promise<RateLimitResponse> => {
    const result = await limiter.isAllowed(request)

    if (result === null) {
      const unavailableResult: RateLimitCheckResult = {
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + config.windowMs,
      }

      return {
        success: false,
        statusCode: 503,
        reason: 'store_unavailable',
        headers: buildHeaders(unavailableResult, config.maxRequests, true),
      }
    }

    if (!result.allowed) {
      return {
        success: false,
        statusCode: 429,
        reason: 'limit_exceeded',
        headers: buildHeaders(result, config.maxRequests, true),
      }
    }

    return {
      success: true,
      headers: buildHeaders(result, config.maxRequests, false),
    }
  }
}

export const RATE_LIMIT_CONFIGS = {
  PUBLIC_API: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    redisKeyPrefix: 'public_api',
    failurePolicy: 'degrade-memory',
  } as RateLimitConfig,

  AUTH: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    redisKeyPrefix: 'auth',
    failurePolicy: 'fail-closed',
  } as RateLimitConfig,

  SELLER_API: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    redisKeyPrefix: 'seller_api',
    failurePolicy: 'degrade-memory',
  } as RateLimitConfig,

  ORDER_CREATION: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    redisKeyPrefix: 'order_creation',
    failurePolicy: 'fail-closed',
  } as RateLimitConfig,

  WEBHOOKS: {
    windowMs: 60 * 1000,
    maxRequests: 1000,
    redisKeyPrefix: 'webhooks',
    failurePolicy: 'degrade-memory',
  } as RateLimitConfig,
}
