import { NextRequest } from 'next/server'
import { logger } from './logger'

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyGenerator?: (request: NextRequest) => string
  redisUrl?: string
  redisKeyPrefix?: string
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

class UpstashRestClient implements RedisClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

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
    if (mode) {
      command.push(mode)
    }
    if (typeof duration === 'number') {
      command.push(duration.toString())
    }

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

class RedisRateLimiter {
  private redis: RedisClient | null = null
  private isRedisAvailable = false
  private fallbackStore = new Map<string, { count: number; resetTime: number }>()

  constructor(private config: RateLimitConfig) {
    this.initializeRedis()
  }

  private async initializeRedis() {
    try {
      const standardRedisUrl = this.config.redisUrl || process.env.REDIS_URL
      const upstashRestUrl = process.env.UPSTASH_REDIS_REST_URL
      const upstashRestToken = process.env.UPSTASH_REDIS_REST_TOKEN

      if (standardRedisUrl) {
        // Try to import and initialize Redis
        const redis = await import('redis')

        // Standard Redis
        this.redis = redis.createClient({ url: standardRedisUrl }) as unknown as RedisClient
        if (this.redis.connect) {
          await this.redis.connect()
        }
      } else if (upstashRestUrl && upstashRestToken) {
        this.redis = new UpstashRestClient(upstashRestUrl.replace(/\/$/, ''), upstashRestToken)
      } else if (upstashRestUrl && !upstashRestToken) {
        throw new Error('UPSTASH_REDIS_REST_TOKEN is required when UPSTASH_REDIS_REST_URL is configured')
      } else {
        throw new Error('Redis is not configured. Set REDIS_URL or both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')
      }

      this.isRedisAvailable = true
      logger.info('Redis rate limiter initialized successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Redis initialization failed in production, using memory fallback. Consider configuring REDIS_URL or UPSTASH_REDIS_REST_URL for optimal performance.', { error: errorMessage })
      } else {
        logger.warn('Redis initialization failed, using memory fallback in development', { error: errorMessage })
      }
      this.isRedisAvailable = false
    }
  }

  private getKey(request: NextRequest): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(request)
    }

    // NextRequest doesn't have ip property, so we need to extract from headers
    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0] || realIp || 'unknown'

    const prefix = this.config.redisKeyPrefix || 'rate_limit'
    return `${prefix}:${ip}`
  }

  private async handleRedisRateLimit(key: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    if (!this.redis) {
      throw new Error('Redis client not available')
    }

    const now = Date.now()
    const windowMs = this.config.windowMs
    const windowSeconds = Math.ceil(windowMs / 1000)
    const redisKey = key

    try {
      // Use Redis INCR and EXPIRE for atomic rate limiting
      if (!this.redis.multi) {
        throw new Error('Redis multi not supported')
      }
      const pipeline = this.redis.multi()
      pipeline.incr(redisKey)
      pipeline.expire(redisKey, windowSeconds)
      const results = await pipeline.exec()

      if (!results || results.length < 2) {
        throw new Error('Redis pipeline failed')
      }

      const currentCount = (results[0] as unknown as [string, number])[1]
      // const expireResult = (results[1] as unknown as [string, number])[1] // Not used currently

      const allowed = currentCount <= this.config.maxRequests
      const remaining = Math.max(0, this.config.maxRequests - currentCount)
      const resetTime = now + (windowMs)

      if (!allowed) {
        logger.warn('Rate limit exceeded', {
          key,
          count: currentCount,
          limit: this.config.maxRequests,
          windowMs: this.config.windowMs,
        })
      }

      return { allowed, remaining, resetTime }
    } catch (error) {
      logger.error('Redis rate limiting error, falling back to memory', error as Error)
      return this.handleMemoryRateLimit(key)
    }
  }

  private handleMemoryRateLimit(key: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now()

    let record = this.fallbackStore.get(key)

    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + this.config.windowMs }
      this.fallbackStore.set(key, record)
    }

    record.count++

    const allowed = record.count <= this.config.maxRequests
    const remaining = Math.max(0, this.config.maxRequests - record.count)

    if (!allowed) {
      logger.warn('Rate limit exceeded (memory fallback)', {
        key,
        count: record.count,
        limit: this.config.maxRequests,
        windowMs: this.config.windowMs,
      })
    }

    return { allowed, remaining, resetTime: record.resetTime }
  }

  async isAllowed(_request: NextRequest): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = this.getKey(_request)

    if (this.isRedisAvailable && this.redis) {
      try {
        return this.handleRedisRateLimit(key)
      } catch (error) {
        logger.warn('Redis rate limiting failed, falling back to memory', { error: error instanceof Error ? error.message : 'Unknown error' })
        return this.handleMemoryRateLimit(key)
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Using memory fallback for rate limiting in production - Redis not available. Consider configuring REDIS_URL or UPSTASH_REDIS_REST_URL for optimal performance.')
      }
      return this.handleMemoryRateLimit(key)
    }
  }

  async resetKey(key: string): Promise<boolean> {
    if (this.isRedisAvailable && this.redis) {
      try {
        await this.redis.del(key)
        return true
      } catch (error) {
        logger.error('Failed to reset Redis key', error as Error)
        return false
      }
    } else {
      this.fallbackStore.delete(key)
      return true
    }
  }

  async getStats(key: string): Promise<{ count: number; remaining: number; resetTime: number } | null> {
    if (this.isRedisAvailable && this.redis) {
      try {
        const value = await this.redis.get(key)
        if (value) {
          const count = parseInt(value, 10)
          const remaining = Math.max(0, this.config.maxRequests - count)
          // For Redis, we don't have the exact reset time, so estimate it
          const resetTime = Date.now() + this.config.windowMs
          return { count, remaining, resetTime }
        }
        return null
      } catch (error) {
        logger.error('Failed to get Redis stats', error as Error)
        return null
      }
    } else {
      const record = this.fallbackStore.get(key)
      if (record) {
        const count = record.count
        const remaining = Math.max(0, this.config.maxRequests - count)
        return { count, remaining, resetTime: record.resetTime }
      }
      return null
    }
  }
}

export class RateLimiter {
  private limiter: RedisRateLimiter

  constructor(config: RateLimitConfig) {
    this.limiter = new RedisRateLimiter(config)
  }

  async isAllowed(request: NextRequest): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    return this.limiter.isAllowed(request)
  }

  async reset(request: NextRequest): Promise<boolean> {
    const key = this.limiter['getKey'](request)
    return this.limiter.resetKey(key)
  }

  async getStats(request: NextRequest) {
    const key = this.limiter['getKey'](request)
    return this.limiter.getStats(key)
  }
}

export function createRateLimit(config: RateLimitConfig) {
  const limiter = new RateLimiter(config)

  return async (request: NextRequest) => {
    const result = await limiter.isAllowed(request)

    if (!result.allowed) {
      return {
        success: false,
        headers: {
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
          'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
        },
      }
    }

    return {
      success: true,
      headers: {
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
      },
    }
  }
}

// Predefined rate limit configurations
export const RATE_LIMIT_CONFIGS = {
  // Public API: 10 requests per minute
  PUBLIC_API: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
    redisKeyPrefix: 'public_api',
  } as RateLimitConfig,

  // Auth endpoints: 5 requests per minute
  AUTH: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5,
    redisKeyPrefix: 'auth',
  } as RateLimitConfig,

  // Seller API: 100 requests per minute
  SELLER_API: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
    redisKeyPrefix: 'seller_api',
  } as RateLimitConfig,

  // Order creation: 20 requests per minute
  ORDER_CREATION: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20,
    redisKeyPrefix: 'order_creation',
  } as RateLimitConfig,

  // Webhooks: 1000 requests per minute
  WEBHOOKS: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 1000,
    redisKeyPrefix: 'webhooks',
  } as RateLimitConfig,
}
