// src/server/lib/monitoring-logger.ts
interface RequestLog {
  timestamp: string;
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  error?: string;
}

class MonitoringLogger {
  private logs: RequestLog[] = [];
  private maxLogs = 1000;

  logRequest(request: RequestLog) {
    this.logs.push(request);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Check for alerts every 20 requests
    if (this.logs.length % 20 === 0) {
      this.checkAlerts();
    }
  }

  private checkAlerts() {
    const recentLogs = this.logs.slice(-50); // Last 50 requests
    
    // Check error rate
    const errors = recentLogs.filter(log => log.statusCode >= 500);
    const errorRate = errors.length / recentLogs.length;
    
    if (errorRate > 0.1) { // 10% error rate threshold
      console.error(`MONITORING_ALERT: HIGH_ERROR_RATE ${(errorRate * 100).toFixed(1)}% (${errors.length}/${recentLogs.length})`);
    }

    // Check slow responses
    const slowResponses = recentLogs.filter(log => log.responseTime > 2000);
    if (slowResponses.length > 5) {
      console.error(`MONITORING_ALERT: SLOW_RESPONSES ${slowResponses.length} requests > 2s`);
    }

    // Check auth failures
    const authFailures = recentLogs.filter(log => 
      log.url.includes('/auth/') && log.statusCode === 401
    );
    if (authFailures.length > 3) {
      console.error(`MONITORING_ALERT: AUTH_FAILURE_SPIKE ${authFailures.length} auth failures`);
    }
  }

  getMetrics() {
    const recentLogs = this.logs.slice(-100); // Last 100 requests
    
    return {
      timestamp: new Date().toISOString(),
      totalRequests: this.logs.length,
      recentRequests: recentLogs.length,
      errorRate: recentLogs.filter(log => log.statusCode >= 500).length / recentLogs.length,
      avgResponseTime: recentLogs.length > 0 
        ? recentLogs.reduce((sum, log) => sum + log.responseTime, 0) / recentLogs.length 
        : 0,
      recentLogs: recentLogs.slice(-10), // Last 10 requests
      alerts: this.getActiveAlerts(recentLogs)
    };
  }

  private getActiveAlerts(logs: RequestLog[]) {
    const alerts: string[] = [];
    
    const errors = logs.filter(log => log.statusCode >= 500);
    const errorRate = errors.length / logs.length;
    if (errorRate > 0.1) {
      alerts.push(`HIGH_ERROR_RATE: ${(errorRate * 100).toFixed(1)}%`);
    }

    const slowResponses = logs.filter(log => log.responseTime > 2000);
    if (slowResponses.length > 5) {
      alerts.push(`SLOW_RESPONSES: ${slowResponses.length}`);
    }

    const authFailures = logs.filter(log => log.url.includes('/auth/') && log.statusCode === 401);
    if (authFailures.length > 3) {
      alerts.push(`AUTH_FAILURE_SPIKE: ${authFailures.length}`);
    }

    return alerts;
  }
}

export const monitoringLogger = new MonitoringLogger();
