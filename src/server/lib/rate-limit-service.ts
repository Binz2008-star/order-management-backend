import { NextRequest } from 'next/server'
import { RateLimitConfig, RateLimitStore, RateLimitResult, FallbackPolicy } from './rate-limit-store'
import { MemoryRateLimitStore } from './rate-limit-memory'
import { UpstashRateLimitStore } from './rate-limit-upstash'
import { RedisRateLimitStore } from './rate-limit-redis-lua'
import { logger } from './logger'

// Fallback policies per route type
const FALLBACK_POLICIES: Record<string, FallbackPolicy> = {
  'auth': 'fail-closed',
  'public_api': 'degrade-memory',
  'seller_api': 'degrade-memory',
  'order_creation': 'fail-closed'
}

// Key generators for different route types (for future use)
const _KEY_GENERATORS = {
  auth: (req: NextRequest) => {
    const forwardedFor = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const _ip = forwardedFor?.split(',')[0] || realIp || 'unknown'
    return `auth:${getIP(req)}:login`
  },
  public_api: (req: NextRequest) => {
    const forwardedFor = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const _ip = forwardedFor?.split(',')[0] || realIp || 'unknown'
    return `public:${getIP(req)}:${req.nextUrl.pathname}`
  },
  seller_api: (req: NextRequest) => {
    const forwardedFor = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const _ip = forwardedFor?.split(',')[0] || realIp || 'unknown'
    return `seller:${getSellerId(req) || getIP(req)}:${req.nextUrl.pathname}`
  },
  order_creation: (req: NextRequest) => {
    const forwardedFor = req.headers.get('x-forwarded-for')
    const realIp = req.headers.get('x-real-ip')
    const _ip = forwardedFor?.split(',')[0] || realIp || 'unknown'
    return `orders:${getSellerId(req) || getIP(req)}:create`
  }
}

function getIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  return forwardedFor?.split(',')[0] || realIp || 'unknown'
}

function getSellerId(_request: NextRequest): string | null {
  // This would be extracted from JWT token in a real implementation
  // For now, return null to fall back to IP
  return null
}

export class RateLimitService {
  private primaryStore: RateLimitStore
  private fallbackStore: RateLimitStore
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
    this.primaryStore = this.createPrimaryStore()
    this.fallbackStore = new MemoryRateLimitStore()
  }

  private createPrimaryStore(): RateLimitStore {
    const redisUrl = process.env.REDIS_URL
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

    // PRODUCTION-GRADE: Use Redis with Lua scripts if available
    if (redisUrl) {
      logger.info('Using Redis with Lua scripts for production-grade rate limiting')
      return new RedisRateLimitStore({
        redisUrl,
        keyPrefix: this.config.redisKeyPrefix
      })
    }

    // FALLBACK: Use Upstash REST API (best-effort)
    if (upstashUrl && upstashToken) {
      logger.warn('Using Upstash REST API - best-effort rate limiting with known race conditions')
      return new UpstashRateLimitStore({
        baseUrl: upstashUrl,
        token: upstashToken,
        keyPrefix: this.config.redisKeyPrefix
      })
    }

    // DEVELOPMENT: Use memory store
    logger.info('Using memory store for rate limiting (development)')
    return this.fallbackStore
  }

  private getKey(request: NextRequest): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(request)
    }

    const prefix = this.config.redisKeyPrefix || 'default'
    const ip = getIP(request)
    return `${prefix}:${ip}`
  }

  private getFallbackPolicy(): FallbackPolicy {
    const prefix = this.config.redisKeyPrefix || 'default'
    return FALLBACK_POLICIES[prefix] || 'degrade-memory'
  }

  async check(request: NextRequest): Promise<RateLimitResult> {
    const key = this.getKey(request)
    const fallbackPolicy = this.getFallbackPolicy()

    try {
      // Try primary store first
      const result = await this.primaryStore.check(key, this.config.maxRequests, this.config.windowMs)

      // Log successful rate limit check
      logger.debug('Rate limit check successful', {
        key,
        store: this.primaryStore.constructor.name,
        allowed: result.allowed,
        remaining: result.remaining
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // CRITICAL: Log fallback activation with observability data
      logger.error(`Rate limiting fallback activated - key: ${key}, policy: ${fallbackPolicy}, store: ${this.primaryStore.constructor.name}, error: ${errorMessage}`)

      return this.handleFallback(key, fallbackPolicy)
    }
  }

  private async handleFallback(key: string, policy: FallbackPolicy): Promise<RateLimitResult> {
    switch (policy) {
      case 'fail-closed':
        throw new Error('Rate limiting service unavailable - request blocked')

      case 'degrade-memory':
        logger.warn('Rate limiting degraded to memory store', { key })
        return await this.fallbackStore.check(key, this.config.maxRequests, this.config.windowMs)

      case 'allow-all':
        logger.error(`Rate limiting completely failed, allowing all requests for key: ${key}`)
        return {
          allowed: true,
          remaining: this.config.maxRequests,
          resetTime: Date.now() + this.config.windowMs
        }

      default:
        throw new Error(`Unknown fallback policy: ${policy}`)
    }
  }

  async reset(request: NextRequest): Promise<boolean> {
    const key = this.getKey(request)

    try {
      return await this.primaryStore.reset(key)
    } catch (_error) {
      logger.warn('Failed to reset rate limit, trying fallback', { key })
      return await this.fallbackStore.reset(key)
    }
  }

  async getStats(request: NextRequest) {
    const key = this.getKey(request)

    try {
      return await this.primaryStore.getStats(key)
    } catch (_error) {
      logger.warn('Failed to get rate limit stats, trying fallback', { key })
      return await this.fallbackStore.getStats(key)
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
}

// Factory function to maintain backward compatibility
export function createRateLimit(config: RateLimitConfig) {
  const service = new RateLimitService(config)

  return async (request: NextRequest) => {
    const result = await service.check(request)

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
