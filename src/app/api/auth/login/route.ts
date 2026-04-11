import { NextRequest } from 'next/server';
import {
  authenticateUser,
  type LoginInput
} from '../../services/auth-boundary';
import {
  createErrorResponse,
  createSuccessResponse,
  validateJsonBody
} from '../../services/route-boundary';

// Simple validation schema for login
const LoginSchema = {
  parse: (data: unknown): LoginInput => {
    const parsed = data as { email?: string; password?: string }
    if (!parsed.email || !parsed.password) {
      throw new Error('Email and password are required')
    }
    return {
      email: parsed.email,
      password: parsed.password
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

