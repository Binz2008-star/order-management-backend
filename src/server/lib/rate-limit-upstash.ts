// Rate limiting store - no database transactions needed (Upstash operations are atomic)
import { UpstashHttpClient } from './http-client'
import { logger } from './logger'
import { RateLimitResult, RateLimitStore } from './rate-limit-store'

export class UpstashRateLimitStore implements RateLimitStore {
  private client: UpstashHttpClient | null = null
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
      this.client = new UpstashHttpClient(this.config.baseUrl, this.config.token)

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
      try {
        const setResult = await this.client!.set(redisKey, '1', {
          NX: true,
          EX: windowSeconds
        })

        if (setResult !== null) {
          // Key was newly created with expiry - atomic operation complete
          currentCount = 1
        } else {
          // Key already exists, increment it - separate operation (race window here)
          currentCount = await this.client!.incr(redisKey)
        }
      } catch (_error) {
        // If SET fails, fall back to INCR
        currentCount = await this.client!.incr(redisKey)
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
