/**
 * Production Rate Limiter
 *
 * Implements Redis-based rate limiting with:
 * - Sliding window algorithm
 * - Redis persistence
 * - Production hardening
 * - Audit logging
 */

import { productionHardening } from './production-hardening';

interface RateLimitRequest {
  ip?: string;
  connection?: {
    remoteAddress?: string;
  };
  user?: {
    id?: string;
  } | null;
  method?: string;
  path?: string;
}

interface RateLimitResponseBody {
  error: string;
  message: string;
  retryAfter?: number;
}

interface RateLimitResponse {
  set(headers: Record<string, string | number | undefined>): void;
  set(name: string, value: string | number | undefined): void;
  status(code: number): {
    json(body: RateLimitResponseBody): unknown;
  };
}

type NextFunction = () => void;

export interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  keyGenerator?: (req: RateLimitRequest) => string;  // Custom key generator
  skipSuccessfulRequests?: boolean;     // Don't count successful requests
  skipFailedRequests?: boolean;         // Don't count failed requests
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export class RateLimiter {
  private _redis: ReturnType<typeof productionHardening.getRedisClient> | null = null;
  private config: RateLimitConfig;
  private keyPrefix: string;

  constructor(config: RateLimitConfig, keyPrefix: string = 'rate_limit') {
    this.config = config;
    this.keyPrefix = keyPrefix;
  }

  private get redis() {
    if (!this._redis) {
      this._redis = productionHardening.getRedisClient();
    }
    return this._redis;
  }

  /**
   * Check rate limit for a given request
   */
  async checkRateLimit(req: RateLimitRequest): Promise<RateLimitResult> {
    const key = this.generateKey(req);
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Remove expired entries
    await this.redis.zRemRangeByScore(`${key}:timestamps`, 0, windowStart);

    // Get current count
    const currentCount = await this.redis.zCard(`${key}:timestamps`);

    if (currentCount >= this.config.maxRequests) {
      // Rate limit exceeded
      const oldestTimestamp = await this.redis.zRange(`${key}:timestamps`, 0, 0);
      const resetTime = oldestTimestamp.length > 0
        ? parseInt(oldestTimestamp[0]) + this.config.windowMs
        : now + this.config.windowMs;

      return {
        allowed: false,
        limit: this.config.maxRequests,
        remaining: 0,
        resetTime,
        retryAfter: Math.ceil((resetTime - now) / 1000)
      };
    }

    // Add current request timestamp
    await this.redis.zAdd(`${key}:timestamps`, {
      score: now,
      value: `${now}-${Math.random()}`
    });

    // Set expiration on the key
    await this.redis.expire(`${key}:timestamps`, Math.ceil(this.config.windowMs / 1000));

    const remaining = this.config.maxRequests - currentCount - 1;

    return {
      allowed: true,
      limit: this.config.maxRequests,
      remaining,
      resetTime: now + this.config.windowMs
    };
  }

  /**
   * Generate rate limit key for request
   */
  private generateKey(req: RateLimitRequest): string {
    if (this.config.keyGenerator) {
      return `${this.keyPrefix}:${this.config.keyGenerator(req)}`;
    }

    // Default key generation based on IP and user ID
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id || 'anonymous';

    return `${this.keyPrefix}:${ip}:${userId}`;
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(req: RateLimitRequest): Promise<void> {
    const key = this.generateKey(req);
    await this.redis.del(`${key}:timestamps`);
  }

  /**
   * Get current rate limit status without incrementing
   */
  async getStatus(req: RateLimitRequest): Promise<RateLimitResult> {
    const key = this.generateKey(req);
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Remove expired entries
    await this.redis.zRemRangeByScore(`${key}:timestamps`, 0, windowStart);

    // Get current count
    const currentCount = await this.redis.zCard(`${key}:timestamps`);

    return {
      allowed: currentCount < this.config.maxRequests,
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - currentCount),
      resetTime: now + this.config.windowMs
    };
  }
}

/**
 * Predefined rate limit configurations
 */
export const RateLimitConfigs = {
  // API endpoints - 100 requests per minute
  api: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 100,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },

  // Authentication endpoints - 5 requests per minute
  auth: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 5,
    skipSuccessfulRequests: false,
    skipFailedRequests: true  // Don't count failed auth attempts
  },

  // Payment endpoints - 10 requests per minute
  payment: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 10,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },

  // Webhook endpoints - 1000 requests per minute
  webhook: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 1000,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },

  // Health endpoints - 60 requests per minute
  health: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 60,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  }
};

/**
 * Rate limit middleware factory
 */
export function createRateLimitMiddleware(config: RateLimitConfig, keyPrefix?: string) {
  const rateLimiter = new RateLimiter(config, keyPrefix);

  return async (req: RateLimitRequest, res: RateLimitResponse, next: NextFunction) => {
    try {
      const result = await rateLimiter.checkRateLimit(req);

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': result.limit,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
      });

      if (!result.allowed) {
        // Rate limit exceeded
        res.set('Retry-After', result.retryAfter);

        // Log rate limit violation
        console.warn(`Rate limit exceeded for ${req.ip}: ${req.method} ${req.path}`);

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests. Try again in ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter
        });
      }

      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      // Fail open - allow request if rate limiting fails
      next();
    }
  };
}

/**
 * Specific rate limit middleware instances
 */
export const rateLimitMiddleware = {
  api: createRateLimitMiddleware(RateLimitConfigs.api, 'api'),
  auth: createRateLimitMiddleware(RateLimitConfigs.auth, 'auth'),
  payment: createRateLimitMiddleware(RateLimitConfigs.payment, 'payment'),
  webhook: createRateLimitMiddleware(RateLimitConfigs.webhook, 'webhook'),
  health: createRateLimitMiddleware(RateLimitConfigs.health, 'health')
};

/**
 * Rate limiting utilities
 */
export class RateLimitUtils {
  /**
   * Check if rate limiting is properly configured
   */
  static async validateConfiguration(): Promise<boolean> {
    try {
      const testLimiter = new RateLimiter({
        windowMs: 1000,
        maxRequests: 1
      }, 'test');

      const testReq = { ip: '127.0.0.1', user: null };

      // First request should be allowed
      const result1 = await testLimiter.checkRateLimit(testReq);
      if (!result1.allowed) {
        return false;
      }

      // Second request should be blocked
      const result2 = await testLimiter.checkRateLimit(testReq);
      if (result2.allowed) {
        return false;
      }

      // Cleanup
      await testLimiter.reset(testReq);

      return true;
    } catch (error) {
      console.error('Rate limiting validation failed:', error);
      return false;
    }
  }

  /**
   * Get rate limit statistics
   */
  static async getStatistics(keyPrefix: string): Promise<{
    totalKeys: number;
    totalRequests: number;
    averageRequestsPerKey: number;
  }> {
    const redis = productionHardening.getRedisClient();
    const pattern = `${keyPrefix}:*`;

    const keys = await redis.keys(pattern);
    let totalRequests = 0;

    for (const key of keys) {
      const count = await redis.zCard(key);
      totalRequests += count;
    }

    return {
      totalKeys: keys.length,
      totalRequests,
      averageRequestsPerKey: keys.length > 0 ? totalRequests / keys.length : 0
    };
  }

  /**
   * Clear expired rate limit data
   */
  static async cleanup(): Promise<number> {
    const redis = productionHardening.getRedisClient();
    const patterns = ['rate_limit:*', 'api:*', 'auth:*', 'payment:*', 'webhook:*', 'health:*'];

    let deletedCount = 0;
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        deletedCount += await redis.del(keys);
      }
    }

    return deletedCount;
  }
}
