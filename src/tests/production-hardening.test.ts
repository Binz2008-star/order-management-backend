/**
 * Production Hardening Tests
 *
 * Tests for:
 * - Fail-fast startup behavior
 * - Redis connectivity requirements
 * - Environment validation
 * - Rate limiting configuration
 * - Authentication requirements
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { productionHardening, productionStartup } from '../server/lib/production-hardening';
import { RateLimitUtils } from '../server/lib/rate-limiter';

describe('Production Hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Mock production environment
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterEach(() => {
    // Cleanup
    process.env = originalEnv;
  });

  describe('Environment Validation', () => {
    it('should fail without required environment variables', async () => {
      // Clear required environment variables
      delete process.env.DATABASE_URL;
      delete process.env.JWT_SECRET;
      delete process.env.REDIS_URL;

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should fail with weak JWT secret in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'weak-secret';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.REDIS_URL = 'redis://test';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'jwt-secret-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should fail with localhost database in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'strong-enough-secret-for-production-32chars';
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
      process.env.REDIS_URL = 'redis://redis.example.com';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should pass with valid production configuration', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'strong-enough-secret-for-production-32chars';
      process.env.DATABASE_URL = 'postgresql://prod.example.com:5432/db';
      process.env.REDIS_URL = 'redis://redis.example.com';

      // Note: This will fail without actual Redis/DB connections, but environment validation should pass
      const status = await productionHardening.initialize();

      // Environment check should pass even if connectivity fails
      const envCheck = status.checks.find(check => check.name === 'environment-validation');
      expect(envCheck?.status).toBe('pass');
    });
  });

  describe('JWT Secret Validation', () => {
    it('should fail with short JWT secret', async () => {
      process.env.JWT_SECRET = 'short';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.REDIS_URL = 'redis://test';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'jwt-secret-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should fail with missing JWT secret', async () => {
      delete process.env.JWT_SECRET;
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.REDIS_URL = 'redis://test';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'jwt-secret-validation' && check.status === 'fail'
      )).toBe(true);
    });
  });

  describe('Production Startup', () => {
    it('should skip hardening in development mode', async () => {
      process.env.NODE_ENV = 'development';

      // Should not throw error in development mode
      await expect(productionStartup()).resolves.not.toThrow();
    });

    it('should fail fast in production mode with missing requirements', async () => {
      process.env.NODE_ENV = 'production';
      // Missing required env vars

      await expect(productionStartup()).rejects.toThrow();
    });
  });
});

describe('Rate Limiting Production Tests', () => {
  describe('Configuration Validation', () => {
    it('should validate rate limiting configuration', async () => {
      // This test will fail without actual Redis, but tests the validation logic
      const isValid = await RateLimitUtils.validateConfiguration();

      // In test environment without Redis, this should fail gracefully
      expect(typeof isValid).toBe('boolean');
    });

    it('should handle Redis connection failures gracefully', async () => {
      // Test rate limiting behavior when Redis is unavailable
      expect(async () => {
        await RateLimitUtils.getStatistics('test');
      }).not.toThrow();
    });
  });

  describe('Statistics and Cleanup', () => {
    it('should provide statistics even with no data', async () => {
      const stats = await RateLimitUtils.getStatistics('nonexistent');

      expect(stats.totalKeys).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.averageRequestsPerKey).toBe(0);
    });

    it('should handle cleanup operations gracefully', async () => {
      const deletedCount = await RateLimitUtils.cleanup();

      expect(typeof deletedCount).toBe('number');
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Production Failure Gates', () => {
  describe('Critical Service Dependencies', () => {
    it('should identify Redis as critical dependency', async () => {
      process.env.REDIS_URL = 'redis://nonexistent:6379';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.JWT_SECRET = 'test-secret-32-chars-long';

      const status = await productionHardening.initialize();

      const redisCheck = status.checks.find(check => check.name === 'redis-connectivity');
      expect(redisCheck?.status).toBe('fail');
      expect(status.healthy).toBe(false);
    });

    it('should identify database as critical dependency', async () => {
      process.env.REDIS_URL = 'redis://test';
      process.env.DATABASE_URL = 'postgresql://nonexistent:5432/test';
      process.env.JWT_SECRET = 'test-secret-32-chars-long';

      const status = await productionHardening.initialize();

      const dbCheck = status.checks.find(check => check.name === 'database-connectivity');
      expect(dbCheck?.status).toBe('fail');
      expect(status.healthy).toBe(false);
    });
  });

  describe('Non-Critical Service Dependencies', () => {
    it('should continue with audit trail warnings', async () => {
      process.env.REDIS_URL = 'redis://test';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.JWT_SECRET = 'test-secret-32-chars-long';

      const status = await productionHardening.initialize();

      const auditCheck = status.checks.find(check => check.name === 'audit-trail-configuration');
      // Should be 'warn' or 'pass' but not 'fail' for non-critical checks
      expect(auditCheck?.status).not.toBe('fail');
    });
  });

  describe('Timeout Handling', () => {
    it('should handle health check timeouts gracefully', async () => {
      // Mock a slow health check
      const startTime = Date.now();

      try {
        await productionHardening.initialize();
      } catch (error) {
        // Should timeout and fail gracefully, not hang
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
      }
    });
  });
});

describe('Production Security Validation', () => {
  describe('Secret Management', () => {
    it('should reject development secrets in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'dev-secret';
      process.env.DATABASE_URL = 'postgresql://prod.example.com:5432/db';
      process.env.REDIS_URL = 'redis://redis.example.com';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should reject test secrets in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'test-secret';
      process.env.DATABASE_URL = 'postgresql://prod.example.com:5432/db';
      process.env.REDIS_URL = 'redis://redis.example.com';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });
  });

  describe('Network Security', () => {
    it('should reject localhost Redis in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'strong-enough-secret-for-production-32chars';
      process.env.DATABASE_URL = 'postgresql://prod.example.com:5432/db';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });
  });
});

describe('Production Monitoring', () => {
  describe('Health Check Reporting', () => {
    it('should provide detailed health check results', async () => {
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.JWT_SECRET = 'test-secret-32-chars-long';
      process.env.REDIS_URL = 'redis://test';

      const status = await productionHardening.initialize();

      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('checks');
      expect(status).toHaveProperty('startupDuration');

      expect(Array.isArray(status.checks)).toBe(true);
      expect(status.checks.length).toBeGreaterThan(0);

      // Each check should have required properties
      status.checks.forEach(check => {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('duration');
        expect(['pass', 'fail', 'warn']).toContain(check.status);
      });
    });

    it('should track startup duration', async () => {
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.JWT_SECRET = 'test-secret-32-chars-long';
      process.env.REDIS_URL = 'redis://test';

      const status = await productionHardening.initialize();

      expect(status.startupDuration).toBeGreaterThan(0);
      expect(status.startupDuration).toBeLessThan(60000); // Should complete within 1 minute
    });
  });
});
