/**
 * Application Startup Orchestration
 *
 * This is the single authoritative boot path for the application.
 * All startup logic must flow through this module.
 */

import './env-validation'; // Auto-validate environment on import
import { productionHardening, setupGracefulShutdown } from './production-hardening';

let started = false;

/**
 * Initialize application startup
 * This must be called before serving any traffic
 */
export async function startup(): Promise<void> {
  if (started) {
    return;
  }

  // Run production hardening checks
  // Environment validation is already done via import above
  const status = await productionHardening.initialize();

  if (!status.healthy) {
    const failedChecks = status.checks
      .filter(c => c.status === 'fail')
      .map(c => c.name)
      .join(', ');

    throw new Error(
      `Startup failed: Critical health checks failed: ${failedChecks}. ` +
      'System cannot start in unhealthy state.'
    );
  }

  started = true;
  console.log('Application startup completed successfully');

  // Setup graceful shutdown after successful startup
  setupGracefulShutdown();
}

// Auto-execute startup in production
if (process.env.NODE_ENV === 'production') {
  startup().catch(error => {
    console.error('Application startup failed:', error);
    process.exit(1);
  });
}

/**
 * Check if startup has been completed
 */
export function isStarted(): boolean {
  return started;
}

/**
 * Reset startup state (for testing only)
 */
export function _resetStartup(): void {
  started = false;
}
