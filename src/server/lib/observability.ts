// === OBSERVABILITY SYSTEM ===
// Request IDs, structured logs, latency measurement, and monitoring

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// === LOG LEVELS ===

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  FATAL = "FATAL",
}

// === STRUCTURED LOG ENTRY ===

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  actorId?: string;
  sellerId?: string;
  errorCode?: string;
  message: string;
  details?: Record<string, unknown>;
  tags?: string[];
}

// === OBSERVABILITY CONTEXT ===

export interface ObservabilityContext {
  requestId: string;
  startTime: number;
  route?: string;
  method?: string;
  actorId?: string;
  sellerId?: string;
  tags: string[];
}

// === LOGGER CLASS ===

export class StructuredLogger {
  private static instance: StructuredLogger;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {}

  static getInstance(): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger();
    }
    return StructuredLogger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const logOutput = {
      ...entry,
      service: "order-management-backend",
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
    };

    // In production, you'd send this to your logging service
    // For now, we'll use console with structured output
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(JSON.stringify(logOutput));
        break;
      case LogLevel.INFO:
        console.info(JSON.stringify(logOutput));
        break;
      case LogLevel.WARN:
        console.warn(JSON.stringify(logOutput));
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(JSON.stringify(logOutput));
        break;
    }
  }

  // Log level methods
  debug(message: string, context?: Partial<LogEntry>): void {
    this.log({ timestamp: new Date().toISOString(), level: LogLevel.DEBUG, message, ...context });
  }

  info(message: string, context?: Partial<LogEntry>): void {
    this.log({ timestamp: new Date().toISOString(), level: LogLevel.INFO, message, ...context });
  }

  warn(message: string, context?: Partial<LogEntry>): void {
    this.log({ timestamp: new Date().toISOString(), level: LogLevel.WARN, message, ...context });
  }

  error(message: string, context?: Partial<LogEntry>): void {
    this.log({ timestamp: new Date().toISOString(), level: LogLevel.ERROR, message, ...context });
  }

  fatal(message: string, context?: Partial<LogEntry>): void {
    this.log({ timestamp: new Date().toISOString(), level: LogLevel.FATAL, message, ...context });
  }
}

// === REQUEST TRACKING ===

export class RequestTracker {
  private static contexts = new Map<string, ObservabilityContext>();
  private static logger = StructuredLogger.getInstance();

  static createContext(request: NextRequest): ObservabilityContext {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    const url = new URL(request.url);
    
    const context: ObservabilityContext = {
      requestId,
      startTime: Date.now(),
      route: url.pathname,
      method: request.method,
      tags: [],
    };

    this.contexts.set(requestId, context);
    
    this.logger.info("Request started", {
      requestId,
      route: context.route,
      method: context.method,
      userAgent: request.headers.get("user-agent"),
      ip: this.getClientIP(request),
    });

    return context;
  }

  static updateContext(requestId: string, updates: Partial<ObservabilityContext>): void {
    const context = this.contexts.get(requestId);
    if (context) {
      Object.assign(context, updates);
    }
  }

  static getContext(requestId: string): ObservabilityContext | undefined {
    return this.contexts.get(requestId);
  }

  static completeRequest(requestId: string, status: number, response?: NextResponse): void {
    const context = this.contexts.get(requestId);
    if (!context) {
      return;
    }

    const durationMs = Date.now() - context.startTime;

    const logLevel = status >= 500 ? LogLevel.ERROR : status >= 400 ? LogLevel.WARN : LogLevel.INFO;
    
    this.logger.log({
      timestamp: new Date().toISOString(),
      level: logLevel,
      requestId,
      route: context.route,
      method: context.method,
      status,
      durationMs,
      actorId: context.actorId,
      sellerId: context.sellerId,
      message: `Request completed (${status})`,
      tags: context.tags,
      details: {
        responseSize: response?.headers.get("content-length"),
        contentType: response?.headers.get("content-type"),
      },
    });

    this.contexts.delete(requestId);
  }

  private static getClientIP(request: NextRequest): string {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown"
    );
  }

  // Add tags to current request context
  static addTag(requestId: string, tag: string): void {
    const context = this.contexts.get(requestId);
    if (context && !context.tags.includes(tag)) {
      context.tags.push(tag);
    }
  }

  // Set actor information
  static setActor(requestId: string, actorId: string, sellerId?: string): void {
    const context = this.contexts.get(requestId);
    if (context) {
      context.actorId = actorId;
      if (sellerId) {
        context.sellerId = sellerId;
      }
    }
  }
}

// === MIDDLEWARE HELPERS ===

export function withObservability(
  handler: (request: NextRequest, context: ObservabilityContext) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const context = RequestTracker.createContext(request);
    
    try {
      const response = await handler(request, context);
      
      // Add request ID to response headers
      response.headers.set("x-request-id", context.requestId);
      
      RequestTracker.completeRequest(context.requestId, response.status, response);
      
      return response;
    } catch (error) {
      RequestTracker.completeRequest(context.requestId, 500);
      
      StructuredLogger.getInstance().error("Unhandled error in request", {
        requestId: context.requestId,
        route: context.route,
        method: context.method,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      
      throw error;
    }
  };
}

// === PERFORMANCE MONITORING ===

export class PerformanceMonitor {
  private static metrics = new Map<string, Array<{ duration: number; timestamp: number }>>();
  private static logger = StructuredLogger.getInstance();

  static trackOperation(name: string, operation: () => Promise<any> | any): Promise<any> {
    const startTime = Date.now();
    
    return Promise.resolve(operation()).then(
      (result) => {
        const duration = Date.now() - startTime;
        this.recordMetric(name, duration);
        
        if (duration > 1000) { // Log slow operations
          this.logger.warn("Slow operation detected", {
            details: {
              operation: name,
              duration,
              threshold: 1000,
            },
          });
        }
        
        return result;
      },
      (error) => {
        const duration = Date.now() - startTime;
        this.recordMetric(name, duration);
        
        this.logger.error("Operation failed", {
          details: {
            operation: name,
            duration,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
        
        throw error;
      }
    );
  }

  private static recordMetric(name: string, duration: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const metric = this.metrics.get(name)!;
    metric.push({ duration, timestamp: Date.now() });
    
    // Keep only last 1000 entries
    if (metric.length > 1000) {
      metric.splice(0, metric.length - 1000);
    }
  }

  static getMetrics(name: string): {
    count: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p95Duration: number;
  } | null {
    const metric = this.metrics.get(name);
    if (!metric || metric.length === 0) {
      return null;
    }

    const durations = metric.map(m => m.duration).sort((a, b) => a - b);
    const count = durations.length;
    const sum = durations.reduce((a, b) => a + b, 0);
    const avgDuration = sum / count;
    const minDuration = durations[0];
    const maxDuration = durations[count - 1];
    const p95Index = Math.floor(count * 0.95);
    const p95Duration = durations[p95Index];

    return {
      count,
      avgDuration,
      minDuration,
      maxDuration,
      p95Duration,
    };
  }

  static getAllMetrics(): Record<string, ReturnType<typeof PerformanceMonitor.getMetrics>> {
    const result: Record<string, ReturnType<typeof PerformanceMonitor.getMetrics>> = {};
    
    for (const [name] of this.metrics) {
      result[name] = this.getMetrics(name);
    }
    
    return result;
  }
}

// === EXTERNAL CALL MONITORING ===

export class ExternalCallMonitor {
  private static logger = StructuredLogger.getInstance();

  static async trackExternalCall<T>(
    serviceName: string,
    operation: () => Promise<T>,
    context?: { requestId?: string; sellerId?: string }
  ): Promise<T> {
    const startTime = Date.now();
    const callId = randomUUID();
    
    this.logger.info("External call started", {
      requestId: context?.requestId,
      details: {
        serviceName,
        operation: operation.name || "unknown",
        callId,
      },
    });

    try {
      const result = await operation();
      const duration = Date.now() - startTime;
      
      this.logger.info("External call completed", {
        requestId: context?.requestId,
        details: {
          serviceName,
          operation: operation.name || "unknown",
          callId,
          duration,
          success: true,
        },
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error("External call failed", {
        requestId: context?.requestId,
        errorCode: "EXTERNAL_CALL_FAILED",
        details: {
          serviceName,
          operation: operation.name || "unknown",
          callId,
          duration,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  }
}

// === HEALTH CHECK MONITORING ===

export interface HealthCheck {
  name: string;
  check: () => Promise<boolean>;
  timeoutMs?: number;
}

export class HealthMonitor {
  private static checks = new Map<string, HealthCheck>();
  private static logger = StructuredLogger.getInstance();

  static registerCheck(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  static async runAllChecks(): Promise<{
    healthy: boolean;
    checks: Record<string, { healthy: boolean; duration: number; error?: string }>;
  }> {
    const results: Record<string, { healthy: boolean; duration: number; error?: string }> = {};
    let overallHealthy = true;

    for (const [name, check] of this.checks) {
      const startTime = Date.now();
      
      try {
        const timeout = check.timeoutMs || 5000;
        const healthy = await Promise.race([
          check.check(),
          new Promise<boolean>((_, reject) => 
            setTimeout(() => reject(new Error("Health check timeout")), timeout)
          ),
        ]);
        
        const duration = Date.now() - startTime;
        results[name] = { healthy, duration };
        
        if (!healthy) {
          overallHealthy = false;
          this.logger.warn("Health check failed", {
            details: {
              check: name,
              duration,
            },
          });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        results[name] = { 
          healthy: false, 
          duration,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        overallHealthy = false;
        
        this.logger.error("Health check error", {
          details: {
            check: name,
            duration,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    return {
      healthy: overallHealthy,
      checks: results,
    };
  }
}

// === EXPORTS ===

export const logger = StructuredLogger.getInstance();
export { RequestTracker, PerformanceMonitor, ExternalCallMonitor, HealthMonitor };
