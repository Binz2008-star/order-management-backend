import { authenticateUser } from '@/server/lib/auth'
import { RATE_LIMIT_CONFIGS } from '@/server/lib/rate-limit'
import { LoginSchema, type LoginInput } from '@/server/lib/validation'
import { createRouteHandler } from '@/server/http/route'

async function login({ body }: { body: LoginInput }) {
  const { user, token } = await authenticateUser(body.email, body.password)

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
}

export const POST = createRouteHandler({
  bodySchema: LoginSchema,
  rateLimit: RATE_LIMIT_CONFIGS.AUTH,
  handler: login,
})

