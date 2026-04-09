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

  private formatMessage(level: string, message: string, context?: LogContext): string {
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
    // Use process.stdout to avoid triggering no-console ESLint rule at call sites
    process.stdout.write(this.formatMessage('INFO', message, context) + '\n')
  }

  error(message: string, error?: Error, context?: LogContext) {
    process.stderr.write(
      this.formatMessage('ERROR', message, {
        ...context,
        error: error
          ? { name: error.name, message: error.message, stack: error.stack }
          : undefined,
      }) + '\n'
    )
  }

  warn(message: string, context?: LogContext) {
    process.stderr.write(this.formatMessage('WARN', message, context) + '\n')
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      process.stdout.write(this.formatMessage('DEBUG', message, context) + '\n')
    }
  }
}

export const logger = Logger.getInstance()

export function generateRequestId(): string {
  return randomUUID()
}
