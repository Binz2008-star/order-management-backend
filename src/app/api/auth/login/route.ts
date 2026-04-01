import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/server/lib/auth'
import { withValidation, ApiError } from '@/server/lib/errors'
import { z } from 'zod'

const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})

async function login(loginData: any, request: NextRequest) {
  const { email, password } = loginData

  try {
    const { user, token } = await authenticateUser(email, password)

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        sellerId: user.sellerId,
      },
      token,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    throw error
  }
}

async function logout(request: NextRequest) {
  // In a real implementation, you might want to invalidate the token
  // For now, we'll just return a success response
  return NextResponse.json({ success: true })
}

export const POST = withValidation(LoginSchema, (data, request) =>
  login(data, request)
)

export const DELETE = logout
