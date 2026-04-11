/**
 * Production Hardening Minimal Correctness Contract
 *
 * These 5 tests establish the behavioral invariants for the production-hardening subsystem.
 * They are validation artifacts, not runtime dependencies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productionHardening, runProductionHardening, setupGracefulShutdown } from '../server/lib/production-hardening';

describe('Production Hardening - Minimal Correctness Contract', () => {
  beforeEach(() => {
    // Reset environment for each test
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('Contract Test 1: Dependency Failure Gating', () => {
    it('should fail when Redis is unavailable', async () => {
      // Missing REDIS_URL should cause failure
      vi.stubEnv('REDIS_URL', undefined);
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
      vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'redis-connectivity' && check.status === 'fail'
      )).toBe(true);
    });
  });

  describe('Contract Test 2: Environment Safety Enforcement', () => {
    it('should fail with localhost database in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/db');
      vi.stubEnv('REDIS_URL', 'redis://redis.example.com');
      vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should fail with localhost Redis in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://prod.example.com:5432/db');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'environment-validation' && check.status === 'fail'
      )).toBe(true);
    });
  });

  describe('Contract Test 3: JWT Integrity Validation', () => {
    it('should fail with short JWT secret', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
      vi.stubEnv('REDIS_URL', 'redis://test');
      vi.stubEnv('JWT_SECRET', 'short');

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'jwt-secret-validation' && check.status === 'fail'
      )).toBe(true);
    });

    it('should fail with missing JWT secret', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
      vi.stubEnv('REDIS_URL', 'redis://test');
      vi.stubEnv('JWT_SECRET', undefined);

      const status = await productionHardening.initialize();

      expect(status.healthy).toBe(false);
      expect(status.checks.some(check =>
        check.name === 'jwt-secret-validation' && check.status === 'fail'
      )).toBe(true);
    });
  });

  describe('Contract Test 4: Fail-Fast Behavior', () => {
    it('should return HardeningStatus structure for orchestration', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
      vi.stubEnv('REDIS_URL', 'redis://test');
      vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');

      const status = await runProductionHardening();

      // Verify structure for orchestration layer
      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('checks');
      expect(status).toHaveProperty('startupDuration');
      expect(typeof status.healthy).toBe('boolean');
      expect(Array.isArray(status.checks)).toBe(true);
      expect(typeof status.startupDuration).toBe('number');
    });

    it('should include failed check names for debugging', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      // Intentionally missing critical env vars
      vi.stubEnv('REDIS_URL', undefined);
      vi.stubEnv('JWT_SECRET', undefined);
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');

      const status = await runProductionHardening();

      // Should have failed checks with names for debugging
      const failedChecks = status.checks.filter(check => check.status === 'fail');
      expect(failedChecks.length).toBeGreaterThan(0);

      // Each failed check should have required properties
      failedChecks.forEach(check => {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('duration');
        expect(check.name).toBeTruthy();
        expect(check.status).toBe('fail');
      });
    });
  });

  describe('Contract Test 5: Timeout and Hanging Dependencies', () => {
    it('should handle timeout when Redis connection hangs', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
      vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');
      vi.stubEnv('REDIS_URL', 'redis://hang-redis.example.com');

      // Mock Redis createClient to hang
      const mockCreateClient = vi.fn(() => ({
        connect: vi.fn(() => new Promise(resolve => setTimeout(resolve, 30000))), // 30 second hang
        ping: vi.fn(() => Promise.resolve('PONG')),
        quit: vi.fn(() => Promise.resolve())
      }));

      vi.doMock('redis', () => ({ createClient: mockCreateClient }));

      const status = await productionHardening.initialize();

      // Should timeout and fail, not hang indefinitely
      expect(status.healthy).toBe(false);
      expect(status.startupDuration).toBeLessThan(20000); // Should complete within timeout bounds
    });
  });

  describe('Graceful Shutdown Setup', () => {
    it('should setup SIGTERM and SIGINT handlers', () => {
      const mockProcessOn = vi.spyOn(process, 'on');

      setupGracefulShutdown();

      expect(mockProcessOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });
  });
});
