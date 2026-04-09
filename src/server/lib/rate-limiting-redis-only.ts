// === REDIS-ONLY RATE LIMITING ===
// Production-grade rate limiting with NO memory fallback

import { Redis } from "ioredis";
import { NextRequest } from "next/server";

// === CONFIGURATION ===

export interface RedisRateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: NextRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message?: string;
}

export interface RedisRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

// === REDIS-ONLY RATE LIMITER ===

export class RedisOnlyRateLimiter {
  private redis: Redis;
  private defaultConfig: Partial<RedisRateLimitConfig>;

  constructor(redisUrl: string, defaultConfig: Partial<RedisRateLimitConfig> = {}) {
    // Fail fast if Redis URL is not provided
    if (!redisUrl) {
      throw new Error("REDIS_URL is required for production rate limiting");
    }

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Enable command timeout to fail fast on Redis issues
      commandTimeout: 5000,
      // Enable health checks
      enableOfflineQueue: false,
      // Fail fast on connection issues
      connectTimeout: 5000,
    });

    this.defaultConfig = defaultConfig;

    // Set up error handling - NO fallback to memory
    this.redis.on("error", (error) => {
      console.error("Redis rate limiting error:", error);
      // In production, this would trigger alerts
      // We DO NOT fall back to memory
    });

    this.redis.on("close", () => {
      console.error("Redis connection closed - rate limiting unavailable");
    });
  }

  // === CORE RATE LIMITING LOGIC ===

  async checkLimit(
    key: string,
    config: RedisRateLimitConfig
  ): Promise<RedisRateLimitResult> {
    const now = Date.now();
    const windowStart = now - config.windowMs;
    const windowEnd = now;

    // Use Redis pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Remove expired entries
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count current requests in window
    pipeline.zcard(key);

    // Add current request
    pipeline.zadd(key, now, `${now}-${Math.random()}`);

    // Set expiration for the key
    pipeline.expire(key, Math.ceil(config.windowMs / 1000));

    try {
      const results = await pipeline.exec();

      if (!results) {
        throw new Error("Redis pipeline failed - rate limiting unavailable");
      }

      const currentCount = (results[1][1] as number) + 1; // +1 for current request
      const allowed = currentCount <= config.maxRequests;

      return {
        allowed,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - currentCount),
        resetTime: windowEnd + config.windowMs,
        retryAfter: allowed ? undefined : Math.ceil(config.windowMs / 1000),
      };
    } catch (error) {
      // CRITICAL: Do NOT fall back to memory
      console.error("Redis rate limiting failed:", error);
      throw new Error(`Rate limiting unavailable: ${error}`);
    }
  }

  // === HEALTH CHECK ===

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      console.error("Redis health check failed:", error);
      return false;
    }
  }

  // === MIDDLEWARE FUNCTION ===

  middleware(config: RedisRateLimitConfig) {
    return async (request: NextRequest): Promise<RedisRateLimitResult> => {
      const key = config.keyGenerator
        ? config.keyGenerator(request)
        : this.generateKey(request);

      const result = await this.checkLimit(key, config);

      // Log rate limiting events
      if (!result.allowed) {
        console.warn("Rate limit exceeded", {
          key,
          limit: result.limit,
          windowMs: config.windowMs,
          ip: this.getClientIP(request),
          userAgent: request.headers.get("user-agent"),
        });
      }

      return result;
    };
  }

  // === KEY GENERATORS ===

  private generateKey(request: NextRequest): string {
    const ip = this.getClientIP(request);
    const path = new URL(request.url).pathname;
    return `rate-limit:${path}:${ip}`;
  }

  private getClientIP(request: NextRequest): string {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown"
    );
  }

  // === PREDEFINED CONFIGURATIONS ===

  static authConfig(): RedisRateLimitConfig {
    return {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 5, // 5 attempts per 15 minutes
      message: "Too many authentication attempts, please try again later",
    };
  }

  static publicOrderConfig(): RedisRateLimitConfig {
    return {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10, // 10 orders per minute
      message: "Too many order creation attempts, please slow down",
    };
  }

  static sellerConfig(): RedisRateLimitConfig {
    return {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100, // 100 requests per minute
      message: "Rate limit exceeded for seller operations",
    };
  }

  static webhookConfig(): RedisRateLimitConfig {
    return {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 1000, // High limit for webhooks
      message: "Webhook rate limit exceeded",
    };
  }

  // === UTILITY METHODS ===

  async resetKey(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async getKeyInfo(key: string): Promise<{
    count: number;
    oldestRequest?: number;
    newestRequest?: number;
  }> {
    const pipeline = this.redis.pipeline();
    pipeline.zcard(key);
    pipeline.zrange(key, 0, 0, "WITHSCORES");
    pipeline.zrange(key, -1, -1, "WITHSCORES");

    const results = await pipeline.exec();
    if (!results) {
      throw new Error("Redis pipeline failed");
    }

    const count = results[0][1] as number;
    const oldest = results[1][1] as string[];
    const newest = results[2][1] as string[];

    return {
      count,
      oldestRequest: oldest.length > 0 ? parseInt(oldest[1]) : undefined,
      newestRequest: newest.length > 0 ? parseInt(newest[1]) : undefined,
    };
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
  }

  // === PRODUCTION MONITORING ===

  async getRedisInfo(): Promise<{
    connected: boolean;
    memory: string;
    clients: number;
    keys: number;
  }> {
    try {
      const info = await this.redis.info("memory clients keyspace");
      const lines = info.split("\r\n");

      const memory = lines.find(line => line.startsWith("used_memory_human:"))?.split(":")[1] || "unknown";
      const clients = parseInt(lines.find(line => line.startsWith("connected_clients:"))?.split(":")[1] || "0");
      const keys = parseInt(lines.find(line => line.startsWith("db0:keys="))?.split(":")[1]?.split(",")[0]?.split("=")[1] || "0");

      return {
        connected: true,
        memory,
        clients,
        keys,
      };
    } catch (error) {
      console.error("Failed to get Redis info:", error);
      return {
        connected: false,
        memory: "unknown",
        clients: 0,
        keys: 0,
      };
    }
  }
}

// === PRODUCTION MIDDLEWARE FACTORY ===

export class ProductionRateLimitingMiddleware {
  private limiter: RedisOnlyRateLimiter;

  constructor(redisUrl: string) {
    // Fail fast if no Redis URL
    if (!redisUrl) {
      throw new Error("REDIS_URL is required for production rate limiting");
    }

    this.limiter = new RedisOnlyRateLimiter(redisUrl);
  }

  // Route-specific rate limiting
  forAuth() {
    return this.limiter.middleware(RedisOnlyRateLimiter.authConfig());
  }

  forPublicOrders() {
    return this.limiter.middleware(RedisOnlyRateLimiter.publicOrderConfig());
  }

  forSellerOperations() {
    return this.limiter.middleware(RedisOnlyRateLimiter.sellerConfig());
  }

  forWebhooks() {
    return this.limiter.middleware(RedisOnlyRateLimiter.webhookConfig());
  }

  // Custom rate limiting
  custom(config: RedisRateLimitConfig) {
    return this.limiter.middleware(config);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    return this.limiter.healthCheck();
  }

  // Monitoring
  async getMetrics() {
    return this.limiter.getRedisInfo();
  }

  // Cleanup
  async cleanup() {
    await this.limiter.cleanup();
  }
}

// === PRODUCTION CONFIGURATION ===

export function getProductionRateLimitConfig(): {
  redisUrl: string;
} {
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required for production rate limiting");
  }

  return { redisUrl };
}

// === ERROR CLASS FOR PRODUCTION ===

export class RateLimitingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitingUnavailableError";
  }
}

// === INITIALIZATION CHECK ===

export function validateRateLimitingSetup(): void {
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

  if (!redisUrl) {
    throw new RateLimitingUnavailableError(
      "Rate limiting is not configured. Set REDIS_URL environment variable."
    );
  }

  console.log("Production rate limiting configured with Redis");
}
