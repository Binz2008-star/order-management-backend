/**
 * Authentication Boundary Layer
 *
 * This file is the ONLY place that can import from server layer.
 * All other API files must use this boundary layer instead.
 */

// These are the ONLY server imports allowed in the API layer
import { prisma } from '@/server/db/prisma'
import { generateToken, verifyPassword } from '@/server/lib/auth'
import { RATE_LIMIT_CONFIGS } from '@/server/lib/rate-limit'

export interface AuthUser {
  id: string
  email: string
  role: 'STAFF' | 'SELLER' | 'ADMIN'
  sellerId: string | null
  isActive: boolean
}

export interface AuthResult {
  user: AuthUser
  token: string
}

export interface LoginInput {
  email: string
  password: string
}

/**
 * Authenticate user with credentials
 * This is the boundary function that handles server dependencies
 */
export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      ownedSeller: {
        select: { id: true },
      },
    },
  })

  if (!user || !user.isActive) {
    throw new Error('Invalid credentials')
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash)

  if (!isValidPassword) {
    throw new Error('Invalid credentials')
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role as 'STAFF' | 'SELLER' | 'ADMIN',
    sellerId: user.ownedSeller?.id || null,
    isActive: user.isActive,
  }

  const token = generateToken(authUser)

  return { user: authUser, token }
}

/**
 * Generate JWT token for user
 */
export function generateUserToken(user: AuthUser): string {
  return generateToken(user)
}

/**
 * Verify password against hash
 */
export async function verifyUserPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return verifyPassword(password, hash)
}

/**
 * Get rate limit configuration
 */
export function getAuthRateLimitConfig() {
  return RATE_LIMIT_CONFIGS.AUTH
}
