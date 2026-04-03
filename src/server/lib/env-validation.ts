// Production environment validation
// This file validates that all required production environment variables are set

interface EnvValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

function looksLikePlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase()

  return normalized.includes('change-in-production')
    || normalized.includes('change-me')
    || normalized.includes('your-')
    || normalized.includes('replace-with-real')
}

export function validateProductionEnvironment(): EnvValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required environment variables
  const required = [
    'JWT_SECRET',
    'NEXTAUTH_SECRET',
    'DATABASE_URL'
  ]

  const optional = [
    'REDIS_URL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'STRIPE_WEBHOOK_SECRET',
    'WHATSAPP_WEBHOOK_SECRET'
  ]

  // Check required variables
  for (const envVar of required) {
    if (!process.env[envVar]) {
      errors.push(`Missing required environment variable: ${envVar}`)
    } else if (envVar.includes('SECRET') && process.env[envVar]!.length < 32) {
      errors.push(`${envVar} must be at least 32 characters for security`)
    } else if (envVar.includes('SECRET') && looksLikePlaceholderSecret(process.env[envVar]!)) {
      errors.push(`${envVar} cannot use a placeholder value`)
    }
  }

  // Check optional variables
  for (const envVar of optional) {
    if (!process.env[envVar]) {
      warnings.push(`Optional environment variable not set: ${envVar}`)
    }
  }

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.REDIS_URL && !process.env.UPSTASH_REDIS_REST_URL) {
      warnings.push('Rate limiting will fall back to in-memory storage - not recommended for production')
    } else if (process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN) {
      errors.push('UPSTASH_REDIS_REST_TOKEN is required when UPSTASH_REDIS_REST_URL is configured')
    }

    if (process.env.DATABASE_URL?.includes('dev.db')) {
      warnings.push('Using development database in production')
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// Auto-validate on import in production
if (process.env.NODE_ENV === 'production') {
  const validation = validateProductionEnvironment()
  
  if (!validation.isValid) {
    console.error('❌ Production environment validation failed:')
    validation.errors.forEach(error => console.error(`  - ${error}`))
    throw new Error('Production environment validation failed')
  }
  
  if (validation.warnings.length > 0) {
    console.warn('⚠️  Production environment warnings:')
    validation.warnings.forEach(warning => console.warn(`  - ${warning}`))
  }
  
  console.log('✅ Production environment validation passed')
}
