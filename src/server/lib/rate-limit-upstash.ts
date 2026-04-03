import { logger } from './logger'
import { RateLimitResult, RateLimitStore } from './rate-limit-store'

interface UpstashResponse<T> {
  result?: T
  error?: string
}

class UpstashRestClient {
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

    const data: UpstashResponse<T> = await response.json()

    if (data.error) {
      throw new Error(`Upstash error: ${data.error}`)
    }

    return data.result as T
  }

  async get(key: string): Promise<string | null> {
    return this.request<string>(['GET', key])
  }

  async set(key: string, value: string, mode?: 'EX' | 'PX', duration?: number): Promise<string | null> {
    const command = ['SET', key, value]
    if (mode && duration) {
      command.push(mode, duration.toString())
    }
    return this.request<string>(command)
  }

  async incr(key: string): Promise<number> {
    return this.request<number>(['INCR', key])
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return this.request<boolean>(['EXPIRE', key, seconds.toString()])
  }

  async del(key: string): Promise<number> {
    return this.request<number>(['DEL', key])
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
      const setResponse = await fetch(`${this.config.baseUrl}/SET`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: redisKey,
          value: '1',
          options: {
            NX: true,
            EX: windowSeconds
          }
        })
      })

      if (setResponse.ok) {
        // Key was newly created with expiry - atomic operation complete
        currentCount = 1
      } else {
        // Key already exists, increment it - separate operation (race window here)
        const incrResponse = await fetch(`${this.config.baseUrl}/INCR`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            key: redisKey
          })
        })

        if (!incrResponse.ok) {
          throw new Error(`Upstash INCR failed with status ${incrResponse.status}`)
        }

        currentCount = await incrResponse.json() as number
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
