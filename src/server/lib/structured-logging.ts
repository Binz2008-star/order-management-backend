import { logger } from './logger'

export interface LogContext {
  requestId?: string
  route?: string
  userId?: string
  method?: string
  duration?: number
  error?: string
  status?: number
}

export function logRequest(context: LogContext, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  // Extract the log context without message to avoid duplication
  const { requestId, route, userId, method, duration, error, status } = context

  const logContext = {
    requestId,
    route,
    userId,
    method,
    duration,
    error,
    status
  }

  switch (level) {
    case 'error':
      logger.error(message, undefined, logContext)
      break
    case 'warn':
      logger.warn(message, logContext)
      break
    default:
      logger.info(message, logContext)
  }
}

export function logPerformance(context: LogContext) {
  if (context.duration && context.duration > 1000) {
    logRequest(context, 'Slow request detected', 'warn')
  }
}
