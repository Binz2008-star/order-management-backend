/**
 * Production Hardening Configuration
 *
 * Implements fail-fast startup and production requirements for:
 * - Redis connectivity
 * - Environment validation
 * - Rate limiting configuration
 * - Authentication requirements
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';

export interface ProductionHealthCheck {
  name: string;
  check: () => Promise<boolean>;
  critical: boolean;
  timeout: number;
}

export interface HardeningStatus {
  healthy: boolean;
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
    duration: number;
  }>;
  startupDuration: number;
}

class ProductionHardening {
  private redisClient: ReturnType<typeof createClient> | null = null;
  private healthChecks: ProductionHealthCheck[] = [];

  constructor() {
    this.setupHealthChecks();
  }

  /**
   * Initialize production hardening with validation
   * Returns complete status without exiting the process
   */
  async initialize(): Promise<HardeningStatus> {
    const startTime = Date.now();
    const results: HardeningStatus['checks'] = [];

    console.log('=== Production Hardening Initialization ===');

    // Critical checks - record failures but don't exit
    for (const check of this.healthChecks.filter(c => c.critical)) {
      const checkStart = Date.now();
      try {
        const passed = await Promise.race([
          check.check(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
          )
        ]);

        results.push({
          name: check.name,
          status: passed ? 'pass' : 'fail',
          duration: Date.now() - checkStart
        });

        if (!passed) {
          console.error(`CRITICAL HEALTH CHECK FAILED: ${check.name}`);
        } else {
          console.log(`PASS: ${check.name}`);
        }
      } catch (error) {
        console.error(`CRITICAL HEALTH CHECK ERROR: ${check.name}`, error);
        results.push({
          name: check.name,
          status: 'fail',
          message: `Critical check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          duration: Date.now() - checkStart
        });
      }
    }

    // Non-critical checks - log warnings but continue
    for (const check of this.healthChecks.filter(c => !c.critical)) {
      const checkStart = Date.now();
      try {
        const passed = await Promise.race([
          check.check(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
          )
        ]);

        results.push({
          name: check.name,
          status: passed ? 'pass' : 'warn',
          message: passed ? undefined : 'Non-critical check failed',
          duration: Date.now() - checkStart
        });

        if (!passed) {
          console.warn(`WARN: ${check.name} - non-critical check failed`);
        } else {
          console.log(`PASS: ${check.name}`);
        }
      } catch (error) {
        console.warn(`WARN: ${check.name} - check error:`, error);
        results.push({
          name: check.name,
          status: 'warn',
          message: `Check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          duration: Date.now() - checkStart
        });
      }
    }

    const startupDuration = Date.now() - startTime;
    const healthy = results.every(r => r.status !== 'fail');

    console.log(`=== Production Hardening Complete (${startupDuration}ms) ===`);
    console.log(`Status: ${healthy ? 'HEALTHY' : 'DEGRADED'}`);

    // Cleanup resources if unhealthy
    if (!healthy) {
      await this.cleanup();
    }

    return {
      healthy,
      checks: results,
      startupDuration
    };
  }

  /**
   * Setup production health checks
   */
  private setupHealthChecks(): void {
    // Redis connectivity - CRITICAL for production rate limiting
    this.healthChecks.push({
      name: 'redis-connectivity',
      check: async () => {
        const redisUrl = process.env.REDIS_URL;
        const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
        const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

        if (!redisUrl && (!upstashUrl || !upstashToken)) {
          throw new Error('Redis not configured - need REDIS_URL or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN');
        }

        try {
          if (redisUrl) {
            // Test standard Redis connection
            this.redisClient = createClient({
              url: redisUrl,
              socket: {
                connectTimeout: 5000
              }
            });

            await this.redisClient.connect();
            await this.redisClient.ping();
            return true;
          } else {
            // Test Upstash Redis connection
            const { UpstashHttpClient } = await import('./http-client');
            const httpClient = new UpstashHttpClient(upstashUrl!.replace(/\/$/, ''), upstashToken!);

            // Test with a simple ping/command
            await httpClient.ping();
            return true;
          }
        } catch (error) {
          throw new Error(`Redis connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      },
      critical: true,
      timeout: 10000
    });

    // Database connectivity - CRITICAL
    this.healthChecks.push({
      name: 'database-connectivity',
      check: async () => {
        if (!process.env.DATABASE_URL) {
          throw new Error('DATABASE_URL not configured');
        }

        try {
          // Simple database connectivity check
          const { PrismaClient } = await import('@prisma/client');
          const prisma = new PrismaClient({
            datasources: {
              db: {
                url: process.env.DATABASE_URL
              }
            }
          });

          await prisma.$queryRaw`SELECT 1`;
          await prisma.$disconnect();
          return true;
        } catch (error) {
          throw new Error(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      },
      critical: true,
      timeout: 15000
    });

    // JWT secret validation - CRITICAL
    this.healthChecks.push({
      name: 'jwt-secret-validation',
      check: async () => {
        if (!process.env.JWT_SECRET) {
          throw new Error('JWT_SECRET not configured');
        }

        if (process.env.JWT_SECRET.length < 32) {
          throw new Error('JWT_SECRET must be at least 32 characters');
        }

        // Test JWT signing/verification
        const jwt = await import('jsonwebtoken');
        const testPayload = { test: true };
        const token = jwt.sign(testPayload, process.env.JWT_SECRET, { expiresIn: '1h' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        return decoded !== null;
      },
      critical: true,
      timeout: 5000
    });

    // Environment validation - CRITICAL
    this.healthChecks.push({
      name: 'environment-validation',
      check: async () => {
        // Environment validation is handled by env-validation.ts module
        // All required variables are already validated on import
        if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || !process.env.REDIS_URL) {
          throw new Error('Required environment variables not properly configured');
        }

        // Additional production validations (redundant with env-validation.ts but kept for clarity)
        if (process.env.NODE_ENV === 'production') {
          if (process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')) {
            throw new Error('Production cannot use localhost database');
          }

          if (process.env.REDIS_URL?.includes('localhost') || process.env.REDIS_URL?.includes('127.0.0.1')) {
            throw new Error('Production cannot use localhost Redis');
          }

          if (process.env.JWT_SECRET === 'dev-secret' || process.env.JWT_SECRET === 'test-secret') {
            throw new Error('Production cannot use default JWT secret');
          }
        }

        return true;
      },
      critical: true,
      timeout: 5000
    });

    // Rate limiting configuration - WARNING
    this.healthChecks.push({
      name: 'rate-limiting-configuration',
      check: async () => {
        if (!this.redisClient) {
          throw new Error('Redis client not initialized');
        }

        // Test rate limiting storage
        const testKey = 'health:test:rate-limit';
        await this.redisClient.setEx(testKey, 1, '1');
        const value = await this.redisClient.get(testKey);
        await this.redisClient.del(testKey);

        return value === '1';
      },
      critical: false,
      timeout: 5000
    });

    // Audit trail configuration - WARNING
    this.healthChecks.push({
      name: 'audit-trail-configuration',
      check: async () => {
        if (!process.env.DATABASE_URL) {
          throw new Error('Database not available for audit trail');
        }

        // Check if audit_events table exists and is accessible
        const prisma = new PrismaClient({
          datasources: {
            db: {
              url: process.env.DATABASE_URL
            }
          }
        });

        try {
          await prisma.$queryRaw`SELECT COUNT(*) FROM audit_events LIMIT 1`;
          await prisma.$disconnect();
          return true;
        } catch (error) {
          await prisma.$disconnect();
          throw new Error(`Audit trail check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      },
      critical: false,
      timeout: 10000
    });
  }

  /**
   * Get Redis client for rate limiting
   */
  getRedisClient() {
    if (!this.redisClient) {
      throw new Error('Redis client not initialized - call initialize() first');
    }
    return this.redisClient;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
  }
}

// Singleton instance
export const productionHardening = new ProductionHardening();

/**
 * Run production hardening validation
 * Returns status for orchestration layer to handle
 */
export async function runProductionHardening(): Promise<HardeningStatus> {
  return await productionHardening.initialize();
}

/**
 * Setup graceful shutdown handlers
 * Call this after successful startup
 */
export function setupGracefulShutdown(): void {
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received - shutting down gracefully');
    await productionHardening.cleanup();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT received - shutting down gracefully');
    await productionHardening.cleanup();
    process.exit(0);
  });
}
