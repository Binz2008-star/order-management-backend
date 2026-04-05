import { NextRequest, NextResponse } from 'next/server'
import { ZodSchema } from 'zod'
import { ApiError, toApiError } from '@/server/http/api-error'
import { jsonError } from '@/server/http/response'

type RouteHandler<T> = (data: T, request: NextRequest) => Promise<NextResponse>

type RouteContext<T> = {
  params: Promise<T>
}

export { ApiError }

export function handleApiError(error: unknown): NextResponse {
  const apiError = toApiError(error)
  return jsonError(apiError, 'legacy-route')
}

export function withValidation<T>(
  schema: ZodSchema<T>,
  handler: RouteHandler<T>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const body = await request.json()
      const data = schema.parse(body)
      return await handler(data, request)
    } catch (error) {
      return handleApiError(error)
    }
  }
}

export function withParamsValidation<T>(
  handler: RouteHandler<T>,
  schema: ZodSchema<T>
) {
  return async (
    request: NextRequest,
    context: RouteContext<unknown>
  ): Promise<NextResponse> => {
    try {
      const data = schema.parse(await context.params)
      return await handler(data, request)
    } catch (error) {
      return handleApiError(error)
    }
  }
}

export function withQueryValidation<T>(
  schema: ZodSchema<T>,
  handler: RouteHandler<T>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url)
      const query = Object.fromEntries(searchParams.entries())
      const data = schema.parse(query)
      return await handler(data, request)
    } catch (error) {
      return handleApiError(error)
    }
  }
}
