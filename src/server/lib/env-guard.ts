/**
 * Environment safety guard for destructive operations
 * Prevents accidental data loss in production environments
 */

const ALLOWED_TEST_ENVIRONMENTS = ['test', 'development', 'local', 'ci'] as const

export interface EnvGuardConfig {
  /** Explicit environment identifier (not just NODE_ENV) */
  appEnv: string
  /** Whether destructive operations are allowed */
  allowDestructiveOps: boolean
}

/**
 * Check if the current environment allows destructive test operations
 * such as database resets, test data cleanup, etc.
 */
export function isDestructiveOpsAllowed(explicitEnv?: string): boolean {
  const env = explicitEnv || process.env.APP_ENV || process.env.NODE_ENV

  if (!env) {
    return false
  }

  const normalized = env.toLowerCase().trim()

  // Must be explicitly in the allowed list
  return (ALLOWED_TEST_ENVIRONMENTS as readonly string[]).includes(normalized)
}

/**
 * Assert that destructive operations are allowed, or throw an error
 */
export function assertDestructiveOpsAllowed(operation: string, explicitEnv?: string): void {
  if (!isDestructiveOpsAllowed(explicitEnv)) {
    throw new Error(
      `[ENV GUARD] Operation "${operation}" is not allowed in environment "${explicitEnv || process.env.APP_ENV || process.env.NODE_ENV}". ` +
      `Destructive operations are only permitted in: ${ALLOWED_TEST_ENVIRONMENTS.join(', ')}.`
    )
  }
}

/**
 * Block seeding in production environments
 */
export function assertSeedingAllowed(): void {
  const env = process.env.APP_ENV || process.env.NODE_ENV

  if (!env) {
    throw new Error(
      '[ENV GUARD] Cannot determine environment. Set NODE_ENV or APP_ENV before running seed.'
    )
  }

  if (env.toLowerCase() === 'production') {
    throw new Error(
      '[ENV GUARD] Seeding is strictly prohibited in production environments. ' +
      'This operation could corrupt production data.'
    )
  }
}

/**
 * Get the current environment configuration
 */
export function getEnvConfig(): EnvGuardConfig {
  const appEnv = process.env.APP_ENV || process.env.NODE_ENV

  if (!appEnv) {
    throw new Error(
      '[ENV GUARD] Cannot determine environment. Set NODE_ENV or APP_ENV.'
    )
  }

  return {
    appEnv,
    allowDestructiveOps: isDestructiveOpsAllowed(appEnv),
  }
}
