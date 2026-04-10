/**
 * Production environment validation (fail-fast)
 * Secure, explicit, and safe across dev/test/prod.
 */

const ALLOWED_NODE_ENVS = ['development', 'test', 'production'] as const
type NodeEnv = (typeof ALLOWED_NODE_ENVS)[number]

export type Env = {
  NODE_ENV: NodeEnv
  DATABASE_URL: string
  REDIS_URL?: string
  JWT_SECRET: string
  BCRYPT_ROUNDS: number
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  const normalized = value?.trim() || 'development'

  if ((ALLOWED_NODE_ENVS as readonly string[]).includes(normalized)) {
    return normalized as NodeEnv
  }

  throw new Error(`[ENV ERROR] Invalid NODE_ENV: ${normalized}`)
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`[ENV ERROR] Missing required environment variable: ${name}`)
  }

  return value
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function requireNumber(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim()

  if (!raw) {
    if (fallback !== undefined) return fallback
    throw new Error(`[ENV ERROR] Missing required numeric env var: ${name}`)
  }

  const parsed = Number(raw)

  if (!Number.isInteger(parsed)) {
    throw new Error(`[ENV ERROR] Invalid integer env var: ${name}`)
  }

  return parsed
}

function validateJwtSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error('[ENV ERROR] JWT_SECRET must be at least 32 characters')
  }

  const insecurePatterns = [
    'fallback',
    'change-in-production',
    'your-super-secret',
    'secret',
    'test',
    'demo',
  ]

  const lowered = secret.toLowerCase()

  if (insecurePatterns.some((pattern) => lowered.includes(pattern))) {
    throw new Error('[ENV ERROR] JWT_SECRET appears to be insecure or placeholder')
  }
}

function validateBcryptRounds(rounds: number): void {
  if (rounds < 10 || rounds > 14) {
    throw new Error('[ENV ERROR] BCRYPT_ROUNDS must be between 10 and 14')
  }
}

export const env: Env = {
  NODE_ENV: parseNodeEnv(process.env.NODE_ENV),
  DATABASE_URL: requireEnv('DATABASE_URL'),
  REDIS_URL: optionalEnv('REDIS_URL'),
  JWT_SECRET: requireEnv('JWT_SECRET'),
  BCRYPT_ROUNDS: requireNumber('BCRYPT_ROUNDS', 12),
}

export function validateProductionEnv(): void {
  validateJwtSecret(env.JWT_SECRET)
  validateBcryptRounds(env.BCRYPT_ROUNDS)

  if (env.NODE_ENV === 'production') {
    if (!env.REDIS_URL) {
      throw new Error('[PRODUCTION FATAL] Missing required env: REDIS_URL')
    }
  }
}

// Validation handled in startup.ts - do not auto-validate here
