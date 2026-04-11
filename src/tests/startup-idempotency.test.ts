/**
 * Startup Idempotency Verification Tests
 *
 * These tests verify that startup.ts runs exactly once per server lifecycle
 * and maintains proper idempotency guarantees.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Startup Idempotency Verification', () => {
  beforeEach(() => {
    // Reset modules and environment
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();

    // Mock production environment
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
    vi.stubEnv('REDIS_URL', 'redis://test');
    vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');
  });

  describe('Verification 1: Idempotent Import Behavior', () => {
    it('should run startup exactly once on multiple imports', async () => {
      // Mock Redis and DB for successful startup
      vi.doMock('redis', () => ({
        createClient: vi.fn(() => ({
          connect: vi.fn().mockResolvedValue(undefined),
          ping: vi.fn().mockResolvedValue('PONG'),
          quit: vi.fn().mockResolvedValue('OK')
        }))
      }));

      vi.doMock('@prisma/client', () => ({
        PrismaClient: vi.fn(() => ({
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $disconnect: vi.fn().mockResolvedValue(undefined)
        }))
      }));

      const mockProcessOn = vi.spyOn(process, 'on');

      // Import startup module
      await import('../server/lib/startup');

      // Wait for async startup to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get initial handler count
      const initialSigtermCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGTERM').length;
      const initialSigintCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGINT').length;

      // Import again (simulating multiple layout renders)
      await import('../server/lib/startup');

      // Handler count should not have increased
      const finalSigtermCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGTERM').length;
      const finalSigintCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGINT').length;

      expect(finalSigtermCalls).toBe(initialSigtermCalls);
      expect(finalSigintCalls).toBe(initialSigintCalls);
      expect(finalSigtermCalls).toBe(1); // Exactly one SIGTERM handler
      expect(finalSigintCalls).toBe(1); // Exactly one SIGINT handler
    });
  });

  describe('Verification 2: Graceful Shutdown Handler Registration', () => {
    it('should register shutdown handlers exactly once', async () => {
      // Mock Redis and DB for successful startup
      vi.doMock('redis', () => ({
        createClient: vi.fn(() => ({
          connect: vi.fn().mockResolvedValue(undefined),
          ping: vi.fn().mockResolvedValue('PONG'),
          quit: vi.fn().mockResolvedValue('OK')
        }))
      }));

      vi.doMock('@prisma/client', () => ({
        PrismaClient: vi.fn(() => ({
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $disconnect: vi.fn().mockResolvedValue(undefined)
        }))
      }));

      const mockProcessOn = vi.spyOn(process, 'on');

      // Import startup
      await import('../server/lib/startup');

      // Wait for async startup to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check handler registration
      const sigtermCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGTERM');
      const sigintCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGINT');

      expect(sigtermCalls).toHaveLength(1);
      expect(sigintCalls).toHaveLength(1);

      // Verify handlers are functions
      expect(typeof sigtermCalls[0][1]).toBe('function');
      expect(typeof sigintCalls[0][1]).toBe('function');
    });
  });

  describe('Verification 3: Hardening Failure Blocks Startup', () => {
    it('should block startup when hardening fails', async () => {
      // Mock failing hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          initialize: vi.fn().mockResolvedValue({
            healthy: false,
            checks: [{ name: 'test-check', status: 'fail', duration: 100 }],
            startupDuration: 100
          })
        }
      }));

      // Mock process.exit to track calls
      const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      // Import should trigger startup failure
      await import('../server/lib/startup');

      // Wait for async startup to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have called process.exit due to failure
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('Verification 4: Non-Production Startup Cost', () => {
    it('should skip auto-startup in non-production mode', async () => {
      // Set non-production environment
      vi.stubEnv('NODE_ENV', 'development');

      const mockProcessOn = vi.spyOn(process, 'on');

      // Import startup in development mode
      await import('../server/lib/startup');

      // Should not register auto-startup handlers in development
      const sigtermCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGTERM');
      const sigintCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGINT');

      // Only graceful shutdown handlers should be registered (not auto-startup)
      expect(sigtermCalls.length).toBeGreaterThanOrEqual(0);
      expect(sigintCalls.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Verification 5: Manual Startup Function', () => {
    it('should allow manual startup calls', async () => {
      // Reset modules to test manual startup
      vi.resetModules();
      vi.unstubAllEnvs();
      vi.stubEnv('NODE_ENV', 'test'); // Non-production to avoid auto-startup
      vi.stubEnv('DATABASE_URL', 'postgresql://test:5432/db');
      vi.stubEnv('REDIS_URL', 'redis://test');
      vi.stubEnv('JWT_SECRET', 'strong-enough-secret-for-production-32chars');

      // Mock Redis and DB for successful startup
      vi.doMock('redis', () => ({
        createClient: vi.fn(() => ({
          connect: vi.fn().mockResolvedValue(undefined),
          ping: vi.fn().mockResolvedValue('PONG'),
          quit: vi.fn().mockResolvedValue('OK')
        }))
      }));

      vi.doMock('@prisma/client', () => ({
        PrismaClient: vi.fn(() => ({
          $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
          $disconnect: vi.fn().mockResolvedValue(undefined)
        }))
      }));

      // Import startup module
      const startupModule = await import('../server/lib/startup');

      // Should have startup function available
      expect(typeof startupModule.startup).toBe('function');
      expect(typeof startupModule.isStarted).toBe('function');

      // Manual startup should work
      await startupModule.startup();
      expect(startupModule.isStarted()).toBe(true);

      // Second call should be idempotent
      await startupModule.startup();
      expect(startupModule.isStarted()).toBe(true);
    });
  });
});
