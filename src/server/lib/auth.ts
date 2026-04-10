import { ApiError } from '@/server/http/api-error'
import bcrypt from 'bcryptjs'
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { prisma } from '../db/prisma'
import { env } from './env'

const JWT_EXPIRES_IN: SignOptions['expiresIn'] = '7d'

type UserRole = 'STAFF' | 'SELLER' | 'ADMIN'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  sellerId: string | null
}

export interface AuthResult {
  user: AuthUser
  token: string
}

interface TokenPayload extends JwtPayload {
  id: string
  email: string
  role: UserRole
  sellerId: string | null
}

export interface SellerAuthUser extends AuthUser {
  sellerId: string
  role: 'SELLER' | 'ADMIN'
}

export interface AdminAuthUser extends AuthUser {
  role: 'ADMIN'
}

// JWT secret validation handled in env.ts startup validation

function assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(401, `Invalid token payload: ${fieldName}`)
  }
}

function normalizeTokenPayload(decoded: string | JwtPayload): TokenPayload {
  if (typeof decoded === 'string') {
    throw new ApiError(401, 'Invalid token')
  }

  assertNonEmptyString(decoded.id, 'id')
  assertNonEmptyString(decoded.email, 'email')
  assertNonEmptyString(decoded.role, 'role')

  const allowedRoles: UserRole[] = ['STAFF', 'SELLER', 'ADMIN']
  if (!allowedRoles.includes(decoded.role as UserRole)) {
    throw new ApiError(401, 'Invalid token role')
  }

  return {
    ...decoded,
    id: decoded.id,
    email: decoded.email,
    role: decoded.role as UserRole,
    sellerId: typeof decoded.sellerId === 'string' ? decoded.sellerId : null,
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateToken(user: AuthUser): string {
  const payload: Omit<TokenPayload, keyof JwtPayload> = {
    id: user.id,
    email: user.email,
    role: user.role,
    sellerId: user.sellerId,
  }

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'order-management-backend',
    audience: 'seller-dashboard',
  })
}

export function verifyToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'order-management-backend',
      audience: 'seller-dashboard',
    })
    const payload = normalizeTokenPayload(decoded)

    return {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      sellerId: payload.sellerId,
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError(401, 'Invalid token')
  }
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        ownedSeller: {
          select: { id: true },
        },
      },
    })

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Invalid credentials')
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash)

    if (!isValidPassword) {
      throw new ApiError(401, 'Invalid credentials')
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      sellerId: user.ownedSeller?.id ?? null,
    }

    return {
      user: authUser,
      token: generateToken(authUser),
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    console.error('Authentication service failed:', error)
    throw new ApiError(500, 'Authentication service unavailable', 'AUTH_SERVICE_UNAVAILABLE')
  }
}

export async function getCurrentUser(request: NextRequest): Promise<AuthUser> {
  const authHeader = request.headers.get('authorization')

  console.log('Auth header:', authHeader?.substring(0, 20) + '...')

  if (!authHeader?.startsWith('Bearer ')) {
    console.log('No Bearer token found')
    throw new ApiError(401, 'No token provided')
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    console.log('Empty token after Bearer')
    throw new ApiError(401, 'No token provided')
  }

  console.log('Token extracted, verifying...')
  return verifyToken(token)
}

export function requireSeller(user: AuthUser): SellerAuthUser {
  if (user.role !== 'SELLER' && user.role !== 'ADMIN') {
    throw new ApiError(403, 'Seller access required')
  }

  if (!user.sellerId) {
    throw new ApiError(403, 'No seller associated with account')
  }

  return user as SellerAuthUser
}

export function requireAdmin(user: AuthUser): AdminAuthUser {
  if (user.role !== 'ADMIN') {
    throw new ApiError(403, 'Admin access required')
  }

  return user as AdminAuthUser
}
