/**
 * Lifecycle Determinism Verification
 *
 * These tests verify that startup.ts has deterministic lifecycle behavior
 * across all execution paths, especially graceful shutdown handler registration.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Lifecycle Determinism Verification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('Determinism Test 1: Handler Registration in Production', () => {
    it('should register handlers deterministically on successful startup', async () => {
      // Mock successful hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          initialize: vi.fn().mockResolvedValue({
            healthy: true,
            checks: [{ name: 'test-check', status: 'pass', duration: 100 }],
            startupDuration: 100
          }),
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      const mockProcessOn = vi.spyOn(process, 'on');

      // Import and run startup
      const startupModule = await import('../server/lib/startup');
      await startupModule.startup();

      // Verify setupGracefulShutdown was called
      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');
      expect(setupGracefulShutdown).toHaveBeenCalledTimes(1);
    });

    it('should NOT register handlers on failed startup', async () => {
      // Mock failed hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          initialize: vi.fn().mockResolvedValue({
            healthy: false,
            checks: [{ name: 'test-check', status: 'fail', duration: 100 }],
            startupDuration: 100
          }),
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');
      const startupModule = await import('../server/lib/startup');

      // Should throw on failed startup
      await expect(startupModule.startup()).rejects.toThrow();

      // Should NOT register handlers on failure
      expect(setupGracefulShutdown).not.toHaveBeenCalled();
    });
  });

  describe('Determinism Test 2: Handler Registration Mechanics', () => {
    it('should register SIGTERM and SIGINT handlers exactly once', async () => {
      // Test setupGracefulShutdown directly
      const mockProcessOn = vi.spyOn(process, 'on');

      // Mock production-hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      // Reset modules and import
      vi.resetModules();
      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');

      setupGracefulShutdown();

      // Verify handlers registered
      expect(mockProcessOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(mockProcessOn).toHaveBeenCalledTimes(2);
    });

    it('should register handlers only once even with multiple calls', async () => {
      const mockProcessOn = vi.spyOn(process, 'on');

      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      vi.resetModules();
      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');

      // Call multiple times
      setupGracefulShutdown();
      setupGracefulShutdown();
      setupGracefulShutdown();

      // Should still only have 2 handlers (1 SIGTERM, 1 SIGINT)
      const sigtermCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGTERM');
      const sigintCalls = mockProcessOn.mock.calls.filter(call => call[0] === 'SIGINT');

      expect(sigtermCalls).toHaveLength(1);
      expect(sigintCalls).toHaveLength(1);
    });
  });

  describe('Determinism Test 3: Production Auto-Execution Path', () => {
    it('should auto-execute startup and register handlers in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
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

      // Mock successful hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          initialize: vi.fn().mockResolvedValue({
            healthy: true,
            checks: [{ name: 'test-check', status: 'pass', duration: 100 }],
            startupDuration: 100
          }),
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      const mockProcessOn = vi.spyOn(process, 'on');

      // Import should trigger auto-execution
      await import('../server/lib/startup');

      // Wait for async startup
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify setupGracefulShutdown was called
      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');
      expect(setupGracefulShutdown).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-execute startup in non-production', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      // Mock hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          initialize: vi.fn().mockResolvedValue({
            healthy: true,
            checks: [{ name: 'test-check', status: 'pass', duration: 100 }],
            startupDuration: 100
          }),
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');

      // Import should NOT trigger auto-execution
      await import('../server/lib/startup');

      // setupGracefulShutdown should NOT be called
      expect(setupGracefulShutdown).not.toHaveBeenCalled();
    });
  });

  describe('Determinism Test 4: Idempotency Across Paths', () => {
    it('should be idempotent across successful startup calls', async () => {
      vi.stubEnv('NODE_ENV', 'test'); // Non-production for manual control

      // Mock successful hardening
      vi.doMock('../server/lib/production-hardening', () => ({
        productionHardening: {
          initialize: vi.fn().mockResolvedValue({
            healthy: true,
            checks: [{ name: 'test-check', status: 'pass', duration: 100 }],
            startupDuration: 100
          }),
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        setupGracefulShutdown: vi.fn()
      }));

      const startupModule = await import('../server/lib/startup');
      const { setupGracefulShutdown } = await import('../server/lib/production-hardening');

      // Multiple startup calls
      await startupModule.startup();
      await startupModule.startup();
      await startupModule.startup();

      // Should only register handlers once
      expect(setupGracefulShutdown).toHaveBeenCalledTimes(1);
      expect(startupModule.isStarted()).toBe(true);
    });
  });
});
