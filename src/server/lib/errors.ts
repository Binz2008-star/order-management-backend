import { NextRequest, NextResponse } from 'next/server'
import { ZodSchema } from 'zod'

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function withValidation<T>(
  schema: ZodSchema<T>,
  handler: (data: T, request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    try {
      const body = await request.json()
      const data = schema.parse(body)
      return await handler(data, request)
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return NextResponse.json(
          { error: 'Validation failed', details: error },
          { status: 400 }
        )
      }
      throw error
    }
  }
}

export function withParamsValidation<T>(
  schema: ZodSchema<T>,
  handler: (data: T, request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest, context: { params: T }) => {
    try {
      const data = schema.parse(context.params)
      return await handler(data, request)
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return NextResponse.json(
          { error: 'Invalid parameters', details: error },
          { status: 400 }
        )
      }
      throw error
    }
  }
}

export function withQueryValidation<T>(
  schema: ZodSchema<T>,
  handler: (data: T, request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url)
      const query = Object.fromEntries(searchParams.entries())
      const data = schema.parse(query)
      return await handler(data, request)
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return NextResponse.json(
          { error: 'Invalid query parameters', details: error },
          { status: 400 }
        )
      }
      throw error
    }
  }
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    )
  }

  if (error instanceof Error) {
    console.error('Unhandled API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { error: 'Unknown error' },
    { status: 500 }
  )
}
