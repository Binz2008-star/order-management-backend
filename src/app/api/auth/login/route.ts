import { authenticateUser } from '@/server/lib/auth'
import { ApiError } from '@/server/lib/errors'
import { RATE_LIMIT_CONFIGS, createRateLimit } from '@/server/lib/rate-limit-service'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})

// Apply strict rate limiting to auth endpoints
const rateLimit = createRateLimit(RATE_LIMIT_CONFIGS.AUTH)

async function login(loginData: unknown, request: NextRequest) {
  console.log('🚀 Login route called', {
    hasData: !!loginData,
    env: process.env.NODE_ENV
  })

  // Rate limiting first
  console.log('📊 Checking rate limit...')
  const rateLimitResult = await rateLimit(request)
  console.log('📊 Rate limit result:', { success: rateLimitResult.success })

  if (!rateLimitResult.success) {
    const statusCode = rateLimitResult.statusCode ?? 429
    const message = statusCode === 503
      ? 'Rate limiting service unavailable'
      : 'Too many login attempts'

    return NextResponse.json(
      { error: message },
      {
        status: statusCode,
        headers: rateLimitResult.headers,
      }
    )
  }

  const { email, password } = loginData as { email: string; password: string }
  console.log('📝 Parsed credentials:', { email, hasPassword: !!password })

  try {
    console.log('🔐 Calling authenticateUser...')
    const { user, token } = await authenticateUser(email, password)
    console.log('✅ Auth successful:', { userId: user.id, role: user.role })

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
    console.log('❌ Auth failed:', error instanceof Error ? error.message : 'Unknown error')
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.log('💥 Unhandled error, rethrowing...')
    throw error
  }
}

async function logout() {
  // In a real implementation, you might want to invalidate the token
  // For now, we'll just return a success response
  return NextResponse.json({ success: true })
}

export async function POST(request: NextRequest) {
  try {
    // Parse JSON body with proper error handling
    let body
    try {
      body = await request.json()
    } catch (err) {
      console.error('❌ Invalid JSON body:', err)
      return NextResponse.json(
        { error: 'Invalid JSON body. Please send valid application/json' },
        { status: 400 }
      )
    }

    // Validate required fields
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body is required and must be an object' },
        { status: 400 }
      )
    }

    // Apply validation and login logic
    try {
      const validatedData = LoginSchema.parse(body)
      return login(validatedData, request)
    } catch (validationError) {
      console.error('❌ Validation error:', validationError)
      return NextResponse.json(
        { error: 'Invalid email or password format' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('💥 Unexpected login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const DELETE = logout
