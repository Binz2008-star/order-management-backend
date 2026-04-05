import { ZodError } from 'zod'

export type ApiErrorDetail = {
  path: string
  message: string
  code: string
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly details?: ApiErrorDetail[]
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function formatZodError(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error
  }

  if (error instanceof ZodError) {
    return new ApiError(400, 'Validation failed', 'VALIDATION_ERROR', formatZodError(error))
  }

  return new ApiError(500, 'Internal server error', 'INTERNAL_ERROR')
}

