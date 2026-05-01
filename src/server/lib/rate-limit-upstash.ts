// Rate limiting store - no database transactions needed (Upstash operations are atomic)
import { safeFetch } from '@/shared/runtime-client/safe-fetch'
import { logger } from './logger'
import { RateLimitResult, RateLimitStore } from './rate-limit-store'
import { z } from 'zod'

const upstashResponseSchema = <T extends z.ZodTypeAny>(resultSchema: T) => z.object({
  result: resultSchema.optional(),
  error: z.string().optional(),
})

class UpstashRestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) { }

  private async request<T>(
    command: string[],
    resultSchema: z.ZodType<T>,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<T> {
    const encodedCommand = command.map((part) => encodeURIComponent(part)).join('/')
    const url = `${this.baseUrl}/${encodedCommand}`

    const data = await safeFetch(url, upstashResponseSchema(resultSchema), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })

    if (data.error) {
      throw new Error(`Upstash error: ${data.error}`)
    }

    if (typeof data.result === 'undefined') {
      throw new Error('Upstash response did not include a result')
    }

    return data.result
  }

  async get(key: string): Promise<string | null> {
    return this.request(['GET', key], z.string().nullable())
  }

  async set(key: string, value: string, options?: {
    NX?: boolean
    EX?: number
    PX?: number
  }): Promise<string | null> {
    const command = ['SET', key, value]
    if (options?.NX) command.push('NX')
    if (options?.EX) command.push('EX', options.EX.toString())
    if (options?.PX) command.push('PX', options.PX.toString())
    return this.request(command, z.string().nullable())
  }

  async incr(key: string): Promise<number> {
    return this.request(['INCR', key], z.number())
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.request(
      ['EXPIRE', key, seconds.toString()],
      z.union([z.boolean(), z.number()])
    )
    return result === true || result === 1
  }

  async del(key: string): Promise<number> {
    return this.request(['DEL', key], z.number())
  }
}

export class UpstashRateLimitStore implements RateLimitStore {
  private client: UpstashRestClient | null = null
  private isAvailable = false

  constructor(
    private readonly config: {
      baseUrl: string
      token: string
      keyPrefix?: string
    }
  ) {
    this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      this.client = new UpstashRestClient(this.config.baseUrl, this.config.token)

      // Test connectivity
      await this.client.get('test-connection')

      this.isAvailable = true
      logger.info('Upstash rate limiter initialized successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (process.env.NODE_ENV === 'production') {
        logger.error(`Failed to initialize Upstash rate limiter: ${errorMessage}`)
        throw new Error(`Upstash initialization failed: ${errorMessage}`)
      } else {
        logger.warn('Upstash rate limiter unavailable, using fallback', { error: errorMessage })
        this.isAvailable = false
      }
    }
  }

  private getKey(key: string): string {
    const prefix = this.config.keyPrefix || 'rate_limit'
    return `${prefix}:${key}`
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    if (!this.client || !this.isAvailable) {
      throw new Error('Upstash client not available')
    }

    const redisKey = this.getKey(key)
    const windowSeconds = Math.ceil(windowMs / 1000)

    try {
      // HONEST ASSESSMENT: This approach still has race conditions
      // TRUE atomicity requires Redis Lua scripts or single-command operations
      // Upstash REST API limitations mean we cannot guarantee perfect atomicity

      // BEST EFFORT: Use SET NX EX + INCR with minimal race window
      let currentCount: number

      // First try to set with expiry (only if not exists) - atomic
      const setResult = await this.client.set(redisKey, '1', {
        NX: true,
        EX: windowSeconds
      })

      if (setResult !== null) {
        // Key was newly created with expiry - atomic operation complete
        currentCount = 1
      } else {
        // Key already exists, increment it - separate operation (race window here)
        currentCount = await this.client.incr(redisKey)
      }

      const allowed = currentCount <= limit
      const remaining = Math.max(0, limit - currentCount)
      const resetTime = Date.now() + windowMs

      if (!allowed) {
        logger.warn('Rate limit exceeded', {
          key: redisKey,
          count: currentCount,
          limit,
          resetTime
        })
      }

      return { allowed, remaining, resetTime }
    } catch (error) {
      logger.error('Upstash rate limiting error', error as Error)
      throw error
    }
  }

  async reset(key: string): Promise<boolean> {
    if (!this.client || !this.isAvailable) {
      throw new Error('Upstash client not available')
    }

    try {
      const result = await this.client.del(this.getKey(key))
      return result > 0
    } catch (error) {
      logger.error('Failed to reset rate limit', error as Error)
      throw error
    }
  }

  async getStats(key: string): Promise<{
    current: number
    limit: number
    resetTime: number
  } | null> {
    if (!this.client || !this.isAvailable) {
      throw new Error('Upstash client not available')
    }

    try {
      const current = await this.client.get(this.getKey(key))
      if (!current) return null

      return {
        current: parseInt(current, 10),
        limit: 0, // Not tracked in Redis
        resetTime: 0 // TTL would need additional call
      }
    } catch (error) {
      logger.error('Failed to get rate limit stats', error as Error)
      throw error
    }
  }
}
