import { randomUUID } from 'crypto'

export interface LogContext {
  requestId?: string
  userId?: string
  sellerId?: string
  orderId?: string
  [key: string]: unknown
}

export class Logger {
  private static instance: Logger
  private requestId?: string

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  setRequestId(requestId: string) {
    this.requestId = requestId
  }

  private formatMessage(level: string, message: string, context?: LogContext) {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      level,
      requestId: this.requestId,
      message,
      ...context,
    }
    return JSON.stringify(logEntry)
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatMessage('INFO', message, context))
  }

  error(message: string, error?: Error, context?: LogContext) {
    console.error(this.formatMessage('ERROR', message, {
      ...context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined
    }))
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatMessage('WARN', message, context))
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage('DEBUG', message, context))
    }
  }
}

export const logger = Logger.getInstance()

export function generateRequestId(): string {
  return randomUUID()
}
