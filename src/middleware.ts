import { generateRequestId, logger } from './server/lib/logger'
import { monitoringMiddleware } from './server/middleware/simple-monitoring'
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: ['/api/:path*'],
}

export default function middleware(request: NextRequest): NextResponse {
  // Generate a unique requestId for every inbound API request
  const requestId = request.headers.get('x-request-id') ?? generateRequestId()
  logger.setRequestId(requestId)

  // Delegate to monitoring middleware
  const response = monitoringMiddleware(request)

  // Propagate requestId in response headers for client correlation
  response.headers.set('x-request-id', requestId)

  return response
}
