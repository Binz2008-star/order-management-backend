import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { prisma } from '../db/prisma'
import { ApiError } from './errors'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production'

export interface AuthUser {
  id: string
  email: string
  role: string
  sellerId?: string
}

export interface AuthResult {
  user: AuthUser
  token: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      sellerId: user.sellerId,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

export function verifyToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      sellerId: decoded.sellerId,
    }
  } catch (error) {
    throw new ApiError(401, 'Invalid token')
  }
}

export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      ownedSeller: true,
    },
  })

  if (!user || !user.isActive) {
    throw new ApiError(401, 'Invalid credentials')
  }

  // For demo purposes, we'll assume password is stored in a separate field
  // In production, you'd have a password field in the users table
  const isValidPassword = await verifyPassword(password, 'hashed_password_placeholder')
  
  if (!isValidPassword) {
    throw new ApiError(401, 'Invalid credentials')
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    sellerId: user.ownedSeller?.id,
  }

  const token = generateToken(authUser)

  return { user: authUser, token }
}

export async function getCurrentUser(request: NextRequest): Promise<AuthUser> {
  const authHeader = request.headers.get('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'No token provided')
  }

  const token = authHeader.substring(7)
  return verifyToken(token)
}

export function requireSeller(user: AuthUser): void {
  if (user.role !== 'SELLER' && user.role !== 'ADMIN') {
    throw new ApiError(403, 'Seller access required')
  }
  
  if (!user.sellerId) {
    throw new ApiError(403, 'No seller associated with account')
  }
}

export function requireAdmin(user: AuthUser): void {
  if (user.role !== 'ADMIN') {
    throw new ApiError(403, 'Admin access required')
  }
}
