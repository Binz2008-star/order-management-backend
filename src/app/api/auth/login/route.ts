import { prisma } from '@/server/db/prisma'
import { ApiError } from '@/server/http/api-error'
import { createRouteHandler } from '@/server/http/route'
import type { AuthUser } from '@/server/lib/auth'
import { generateToken, verifyPassword } from '@/server/lib/auth'
import { RATE_LIMIT_CONFIGS } from '@/server/lib/rate-limit'
import { LoginSchema, type LoginInput } from '@/server/lib/validation'
import { Prisma } from '@prisma/client'

async function authenticateUserWithTransaction(
  email: string,
  password: string,
  tx: Prisma.TransactionClient = prisma
): Promise<{ user: AuthUser; token: string }> {
  console.error('LOGIN_DEBUG: Finding user', { email: email.toLowerCase().trim() })

  const user = await tx.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      ownedSeller: {
        select: { id: true },
      },
    },
  })

  console.error('LOGIN_DEBUG: User query result', {
    userFound: !!user,
    isActive: user?.isActive,
    userId: user?.id
  })

  if (!user || !user.isActive) {
    console.error('LOGIN_DEBUG: User not found or inactive')
    throw new ApiError(401, 'Invalid credentials')
  }

  console.error('LOGIN_DEBUG: Verifying password')
  const isValidPassword = await verifyPassword(password, user.passwordHash)
  console.error('LOGIN_DEBUG: Password verification result', { isValid: isValidPassword })

  if (!isValidPassword) {
    console.error('LOGIN_DEBUG: Invalid password')
    throw new ApiError(401, 'Invalid credentials')
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role as 'STAFF' | 'SELLER' | 'ADMIN',
    sellerId: user.ownedSeller?.id ?? null,
  }

  console.error('LOGIN_DEBUG: Generating token')
  const token = generateToken(authUser)
  console.error('LOGIN_DEBUG: Token generated', { hasToken: !!token })

  return {
    user: authUser,
    token,
  }
}

async function login({ body }: { body: LoginInput }) {
  console.error('LOGIN_DEBUG: Starting login process', {
    email: body.email,
    hasBody: !!body,
    bodyType: typeof body,
    bodyKeys: body ? Object.keys(body) : null
  })

  // Test Zod validation first
  try {
    console.error('LOGIN_DEBUG: Testing Zod validation')
    const validationResult = LoginSchema.parse(body)
    console.error('LOGIN_DEBUG: Zod validation passed', {
      validatedEmail: validationResult.email
    })
  } catch (zodError) {
    console.error('LOGIN_DEBUG: Zod validation failed', {
      zodError: zodError instanceof Error ? zodError.message : zodError,
      zodIssues: zodError && typeof zodError === 'object' && 'issues' in zodError ? zodError.issues : null
    })
    throw zodError
  }

  try {
    // Real authentication against database
    console.error('LOGIN_DEBUG: Authenticating against database')
    const { user, token } = await authenticateUserWithTransaction(
      body.email,
      body.password
    )
    console.error('LOGIN_DEBUG: Authentication successful', { userId: user.id })

    return {
      body: { user, token },
    }
  } catch (error) {
    console.error('LOGIN_ERROR', {
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      errorType: typeof error,
      errorName: error && typeof error === 'object' && 'name' in error ? error.name : null,
    })
    throw error
  }
}

export const POST = createRouteHandler({
  bodySchema: LoginSchema,
  rateLimit: RATE_LIMIT_CONFIGS.AUTH,
  handler: login,
})
