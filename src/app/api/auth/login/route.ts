import {
  authenticateUser,
  type LoginInput
} from '@/app/api/services/auth-boundary';
import {
  createErrorResponse,
  createSuccessResponse,
  validateJsonBody
} from '@/app/api/services/route-boundary';
import { NextRequest } from 'next/server';

// Simple validation schema for login
const LoginSchema = {
  parse: (data: { email?: string; password?: string }): LoginInput => {
    if (!data.email || !data.password) {
      throw new Error('Email and password are required')
    }
    return {
      email: data.email,
      password: data.password
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Validate request body
    const body = await validateJsonBody(request, LoginSchema)

    // Authenticate user using boundary layer
    const authResult = await authenticateUser(body.email, body.password)

    // Return success response
    return createSuccessResponse({
      user: {
        id: authResult.user.id,
        email: authResult.user.email,
        role: authResult.user.role,
        sellerId: authResult.user.sellerId,
      },
      token: authResult.token,
    })
  } catch (error) {
    console.error('Login error:', error)

    // Return error response
    if (error instanceof Error) {
      if (error.message === 'Invalid credentials') {
        return createErrorResponse('Invalid credentials', 401)
      }
      return createErrorResponse(error.message)
    }

    return createErrorResponse('Internal server error', 500)
  }
}

