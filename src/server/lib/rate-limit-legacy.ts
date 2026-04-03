// Legacy rate limiter - DEPRECATED
// Use rate-limit-service.ts for production Redis-backed rate limiting
// This file kept for backward compatibility during migration

import { NextRequest } from 'next/server'
import { logger } from './logger'
import { createRateLimit as createNewRateLimit, RATE_LIMIT_CONFIGS } from './rate-limit-service'

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

    const forwardedFor = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0] || realIp || 'unknown'

    return `rate_limit:${ip}`
  }

  async isAllowed(request: NextRequest): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    // Try new service first, fallback to memory for backward compatibility
    try {
      const newRateLimit = createNewRateLimit(this.config)
      const result = await newRateLimit(request)
      return result.success ?
        { allowed: true, remaining: parseInt(result.headers['X-RateLimit-Remaining']), resetTime: new Date(result.headers['X-RateLimit-Reset']).getTime() } :
        { allowed: false, remaining: parseInt(result.headers['X-RateLimit-Remaining']), resetTime: new Date(result.headers['X-RateLimit-Reset']).getTime() }
    } catch (error) {
      logger.warn('New rate limiting failed, using memory fallback', { error: error instanceof Error ? error.message : 'Unknown error' })
      return this.isAllowedMemory(request)
    }
  }

  private isAllowedMemory(request: NextRequest): { allowed: boolean; remaining: number; resetTime: number } {
    const key = this.getKey(request)
    const now = Date.now()
    const windowMs = this.config.windowMs

    let record = defaultStore.get(key)

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      }
      defaultStore.set(key, record)
    } else {
      record.count++
    }

    const allowed = record.count <= this.config.maxRequests
    const remaining = Math.max(0, this.config.maxRequests - record.count)

    if (!allowed) {
      logger.warn('Rate limit exceeded (memory fallback)', {
        key,
        count: record.count,
        limit: this.config.maxRequests,
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
