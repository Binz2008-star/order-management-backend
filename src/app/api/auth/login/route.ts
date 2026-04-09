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
  const user = await tx.user.findUnique({
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
    role: user.role as 'STAFF' | 'SELLER' | 'ADMIN',
    sellerId: user.ownedSeller?.id ?? null,
  }

  return {
    user: authUser,
    token: generateToken(authUser),
  }
}

async function login({ body }: { body: LoginInput }) {
  return await prisma.$transaction(async (tx) => {
    const { user, token } = await authenticateUserWithTransaction(body.email, body.password, tx)

    return {
      body: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          sellerId: user.sellerId,
        },
        token,
      },
    }
  })
}

export const POST = createRouteHandler({
  bodySchema: LoginSchema,
  rateLimit: RATE_LIMIT_CONFIGS.AUTH,
  handler: login,
})

