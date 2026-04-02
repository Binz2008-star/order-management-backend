// Legacy rate limiter - DEPRECATED
// Use rate-limit-redis.ts for production Redis-backed rate limiting
// This file kept for backward compatibility during migration

import { NextRequest } from 'next/server'
import { logger } from './logger'
import { createRateLimit as createRedisRateLimit, RATE_LIMIT_CONFIGS } from './rate-limit-redis'

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyGenerator?: (request: NextRequest) => string
}

// Memory-based fallback for development/testing
const defaultStore = new Map<string, { count: number; resetTime: number }>()

export class RateLimiter {
  constructor(private config: RateLimitConfig) { }

  private getKey(request: NextRequest): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(request)
    }

    // NextRequest doesn't have ip property, so we need to extract from headers
    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0] || realIp || 'unknown'

    return `rate_limit:${ip}`
  }

  async isAllowed(request: NextRequest): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    // Try Redis first, fallback to memory
    try {
      const redisRateLimit = createRedisRateLimit(this.config)
      const result = await redisRateLimit(request)
      return result.success ?
        { allowed: true, remaining: parseInt(result.headers['X-RateLimit-Remaining']), resetTime: new Date(result.headers['X-RateLimit-Reset']).getTime() } :
        { allowed: false, remaining: parseInt(result.headers['X-RateLimit-Remaining']), resetTime: new Date(result.headers['X-RateLimit-Reset']).getTime() }
    } catch (error) {
      logger.warn('Redis rate limiting failed, using memory fallback', { error: error instanceof Error ? error.message : 'Unknown error' })
      return this.isAllowedMemory(request)
    }
  }

  private isAllowedMemory(request: NextRequest): { allowed: boolean; remaining: number; resetTime: number } {
    const key = this.getKey(request)
    const now = Date.now()

    let record = defaultStore.get(key)

    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + this.config.windowMs }
      defaultStore.set(key, record)
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

// Export Redis configurations for easy migration
export { RATE_LIMIT_CONFIGS }

// Helper function to migrate from memory to Redis rate limiting
export function migrateToRedisRateLimit(oldConfig: RateLimitConfig) {
  // Map old configs to Redis equivalents
  if (oldConfig.windowMs === 60 * 1000 && oldConfig.maxRequests === 10) {
    return RATE_LIMIT_CONFIGS.PUBLIC_API
  }
  if (oldConfig.windowMs === 60 * 1000 && oldConfig.maxRequests === 5) {
    return RATE_LIMIT_CONFIGS.AUTH
  }
  if (oldConfig.windowMs === 60 * 1000 && oldConfig.maxRequests === 100) {
    return RATE_LIMIT_CONFIGS.SELLER_API
  }

  // Default to SELLER_API if no match
  return { ...RATE_LIMIT_CONFIGS.SELLER_API, ...oldConfig }
}
