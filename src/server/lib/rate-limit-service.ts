import type { NextRequest } from 'next/server'
import {
  createRateLimit as createCanonicalRateLimit,
  RATE_LIMIT_CONFIGS,
  RateLimiter,
  type RateLimitCheckResult,
  type RateLimitConfig,
  type RateLimitFailurePolicy,
  type RateLimitResponse,
  type RateLimitStore,
  type RateLimitStoreStats,
} from './rate-limit-redis'

export type {
  RateLimitCheckResult,
  RateLimitConfig,
  RateLimitFailurePolicy,
  RateLimitResponse,
  RateLimitStore,
  RateLimitStoreStats,
}

export { RATE_LIMIT_CONFIGS }

export class RateLimitService {
  private readonly limiter: RateLimiter
  private readonly config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
    this.limiter = new RateLimiter(config)
  }

  async check(request: NextRequest): Promise<RateLimitCheckResult> {
    const result = await this.limiter.isAllowed(request)

    if (result === null) {
      throw new Error('Rate limiting service unavailable')
    }

    return result
  }

  async reset(request: NextRequest): Promise<boolean> {
    return this.limiter.reset(request)
  }

  async getStats(request: NextRequest): Promise<RateLimitStoreStats | null> {
    return this.limiter.getStats(request)
  }

  getConfig(): RateLimitConfig {
    return this.config
  }
}

export function createRateLimit(config: RateLimitConfig) {
  return createCanonicalRateLimit(config)
}
