import { NextRequest } from 'next/server'
import { prisma } from '../db/prisma'
import { logger, generateRequestId } from '../lib/logger'

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyGenerator?: (request: NextRequest) => string
}

const defaultStore = new Map<string, { count: number; resetTime: number }>()

export class RateLimiter {
  constructor(private config: RateLimitConfig) {}

  private getKey(request: NextRequest): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(request)
    }
    
    const ip = request.ip || 
      request.headers.get('x-forwarded-for')?.split(',')[0] || 
      request.headers.get('x-real-ip') || 
      'unknown'
    
    return `rate_limit:${ip}`
  }

  async isAllowed(request: NextRequest): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
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
      logger.warn('Rate limit exceeded', {
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
