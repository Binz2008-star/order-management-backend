/**
 * Production environment validation (fail-fast)
 * Secure, explicit, and safe across dev/test/prod.
 */

const ALLOWED_NODE_ENVS = ['development', 'test', 'production'] as const
const INSECURE_SECRET_PATTERNS = [
  'fallback',
  'change-in-production',
  'your-super-secret',
  'secret',
  'test',
  'demo',
] as const

const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

type NodeEnv = (typeof ALLOWED_NODE_ENVS)[number]

export type Env = {
  NODE_ENV: NodeEnv
  DATABASE_URL: string
  DATABASE_URL_DEV?: string
  REDIS_URL?: string
  JWT_SECRET: string
  NEXTAUTH_SECRET?: string
  BCRYPT_ROUNDS: number
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  STRIPE_WEBHOOK_SECRET?: string
  WHATSAPP_WEBHOOK_SECRET?: string
  CRON_SECRET?: string
  CRON_RECONCILE_LIMIT?: string
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

function validateSecretStrength(name: 'JWT_SECRET' | 'NEXTAUTH_SECRET', secret: string): void {
  if (secret.length < 32) {
    throw new Error(`[ENV ERROR] ${name} must be at least 32 characters`)
  }

  const lowered = secret.toLowerCase()

  if (INSECURE_SECRET_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    throw new Error(`[ENV ERROR] ${name} appears to be insecure or placeholder`)
  }
}

export function validateJwtSecret(secret: string): void {
  validateSecretStrength('JWT_SECRET', secret)
}

export function validateNextAuthSecret(secret: string): void {
  validateSecretStrength('NEXTAUTH_SECRET', secret)
}

export function validateBcryptRounds(rounds: number): void {
  if (rounds < 10 || rounds > 14) {
    throw new Error('[ENV ERROR] BCRYPT_ROUNDS must be between 10 and 14')
  }
}

function buildEnv(): Env {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV)

  return {
    NODE_ENV: nodeEnv,
    DATABASE_URL: requireEnv('DATABASE_URL'),
    DATABASE_URL_DEV: optionalEnv('DATABASE_URL_DEV'),
    REDIS_URL: optionalEnv('REDIS_URL'),
    JWT_SECRET: requireEnv('JWT_SECRET'),
    NEXTAUTH_SECRET: optionalEnv('NEXTAUTH_SECRET'),
    BCRYPT_ROUNDS: requireNumber('BCRYPT_ROUNDS', 12),
    UPSTASH_REDIS_REST_URL: optionalEnv('UPSTASH_REDIS_REST_URL'),
    UPSTASH_REDIS_REST_TOKEN: optionalEnv('UPSTASH_REDIS_REST_TOKEN'),
    STRIPE_WEBHOOK_SECRET: optionalEnv('STRIPE_WEBHOOK_SECRET'),
    WHATSAPP_WEBHOOK_SECRET: optionalEnv('WHATSAPP_WEBHOOK_SECRET'),
    CRON_SECRET: optionalEnv('CRON_SECRET'),
    CRON_RECONCILE_LIMIT: optionalEnv('CRON_RECONCILE_LIMIT'),
  }
}

let cachedEnv: Env | null = null

export function loadEnv(options?: { forceReload?: boolean }): Env {
  if (!cachedEnv || options?.forceReload) {
    cachedEnv = buildEnv()
  }

  return cachedEnv
}

const envProxy = new Proxy({} as Env, {
  get: (_target, prop: keyof Env & string) => {
    const currentEnv = loadEnv()
    return currentEnv[prop]
  },
}) as Env

export const env: Env = envProxy

if (!isTestRuntime) {
  loadEnv()
}

export function validateProductionEnv(): void {
  const currentEnv = loadEnv({ forceReload: isTestRuntime })

  validateJwtSecret(currentEnv.JWT_SECRET)
  validateBcryptRounds(currentEnv.BCRYPT_ROUNDS)

  if (currentEnv.NODE_ENV !== 'production' && currentEnv.NEXTAUTH_SECRET) {
    validateNextAuthSecret(currentEnv.NEXTAUTH_SECRET)
  }

  if (currentEnv.NODE_ENV === 'production') {
    if (!currentEnv.NEXTAUTH_SECRET) {
      throw new Error('[PRODUCTION FATAL] Missing required env: NEXTAUTH_SECRET')
    }

    validateNextAuthSecret(currentEnv.NEXTAUTH_SECRET)

    const hasRedis = Boolean(currentEnv.REDIS_URL)
    const hasUpstash = Boolean(currentEnv.UPSTASH_REDIS_REST_URL)

    if (!hasRedis && !hasUpstash) {
      throw new Error('[PRODUCTION FATAL] Missing required env: REDIS_URL')
    }

    if (currentEnv.UPSTASH_REDIS_REST_URL && !currentEnv.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('[PRODUCTION FATAL] Missing required env: UPSTASH_REDIS_REST_TOKEN')
    }

    if (currentEnv.DATABASE_URL?.includes('dev.db')) {
      throw new Error('[PRODUCTION FATAL] Using development database in production')
    }

    if (!currentEnv.CRON_SECRET) {
      throw new Error('[PRODUCTION FATAL] Missing required env: CRON_SECRET')
    }
  }
}

// Validation handled in startup.ts - do not auto-validate here
