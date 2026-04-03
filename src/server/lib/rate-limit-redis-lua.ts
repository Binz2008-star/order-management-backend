import { createClient, RedisClientType } from 'redis'
import { RateLimitStore, RateLimitResult } from './rate-limit-store'
import { logger } from './logger'

export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClientType | null = null
  private isAvailable = false

  constructor(private config: {
    redisUrl: string
    keyPrefix?: string
  }) {
    this.initialize()
  }

  private async initialize(): Promise<void> {
    try {
      this.client = createClient({
        url: this.config.redisUrl,
        socket: {
          connectTimeout: 5000
        }
      })

      this.client.on('error', (error) => {
        logger.error(`Redis client error: ${error.message}`)
        this.isAvailable = false
      })

      this.client.on('connect', () => {
        logger.info('Redis client connected')
        this.isAvailable = true
      })

      await this.client.connect()

      // Test connectivity
      await this.client.ping()

      this.isAvailable = true
      logger.info('Redis rate limiter initialized successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to initialize Redis rate limiter: ${errorMessage}`)
      this.isAvailable = false
    }
  }

  private getKey(key: string): string {
    const prefix = this.config.keyPrefix || 'rate_limit'
    return `${prefix}:${key}`
  }

  // PRODUCTION-GRADE: Atomic rate limiting with Lua script
  private readonly atomicRateLimitScript = `
    -- KEYS[1]: rate limit key
    -- ARGV[1]: window in seconds
    -- ARGV[2]: limit

    local current = redis.call('INCR', KEYS[1])

    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end

    local remaining = math.max(0, tonumber(ARGV[2]) - current)
    local allowed = current <= tonumber(ARGV[2])

    return {current, remaining, allowed}
  `

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    if (!this.client || !this.isAvailable) {
      throw new Error('Redis client not available')
    }

    const redisKey = this.getKey(key)
    const windowSeconds = Math.ceil(windowMs / 1000)

    try {
      // ATOMIC: Execute Lua script server-side
      const result = await this.client.eval(
        this.atomicRateLimitScript,
        {
          keys: [redisKey],
          arguments: [windowSeconds.toString(), limit.toString()]
        }
      )

      if (!Array.isArray(result) || result.length !== 3) {
        throw new Error('Invalid Lua script result')
      }

      const [current, remaining, allowed] = result as [number, number, number]
      const resetTime = Date.now() + windowMs

      if (!allowed) {
        logger.warn('Rate limit exceeded', {
          key: redisKey,
          count: current,
          limit,
          resetTime
        })
      }

      return { allowed, remaining, resetTime }
    } catch (error) {
      logger.error('Redis rate limiting error', error as Error)
      throw error
    }
  }

  async reset(key: string): Promise<boolean> {
    if (!this.client || !this.isAvailable) {
      throw new Error('Redis client not available')
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
      throw new Error('Redis client not available')
    }

    try {
      const [current, ttl] = await Promise.all([
        this.client.get(this.getKey(key)),
        this.client.ttl(this.getKey(key))
      ])

      if (!current) return null

      return {
        current: parseInt(current, 10),
        limit: 0, // Not tracked in Redis
        resetTime: ttl && ttl > 0 ? Date.now() + (ttl * 1000) : 0
      }
    } catch (error) {
      logger.error('Failed to get rate limit stats', error as Error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect()
      this.client = null
      this.isAvailable = false
    }
  }
}
