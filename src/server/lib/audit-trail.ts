/**
 * Audit Trail Service
 *
 * Provides comprehensive audit logging for runtime operations.
 * Maintains audit trail for all critical business operations.
 */

import { prisma } from '@/server/db/prisma';

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditTrail {
  /**
   * Log an audit event
   */
  async log(event: AuditEvent): Promise<void> {
    try {
      await prisma.auditEvent.create({
        data: {
          actorId: event.userId,
          eventType: `${event.action}_${event.entityType.toUpperCase()}`,
          payloadJson: JSON.stringify({
            action: event.action,
            entityType: event.entityType,
            entityId: event.entityId,
            metadata: event.metadata,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            timestamp: new Date().toISOString()
          })
        }
      });
    } catch (error) {
      // Log audit failure but don't break main flow
      console.warn('Failed to log audit event:', error);
    }
  }

  /**
   * Log order creation
   */
  async logOrderCreated(orderId: string, userId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.log({
      action: 'CREATE',
      entityType: 'ORDER',
      entityId: orderId,
      userId,
      metadata
    });
  }

  /**
   * Log order status change
   */
  async logOrderStatusChanged(orderId: string, userId: string, oldStatus: string, newStatus: string): Promise<void> {
    await this.log({
      action: 'STATUS_CHANGE',
      entityType: 'ORDER',
      entityId: orderId,
      userId,
      metadata: { oldStatus, newStatus }
    });
  }

  /**
   * Log payment attempt
   */
  async logPaymentAttempt(paymentId: string, orderId: string, userId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.log({
      action: 'PAYMENT_ATTEMPT',
      entityType: 'PAYMENT',
      entityId: paymentId,
      userId,
      metadata: { orderId, ...metadata }
    });
  }

  /**
   * Log payment completion
   */
  async logPaymentCompleted(paymentId: string, orderId: string, userId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.log({
      action: 'PAYMENT_COMPLETED',
      entityType: 'PAYMENT',
      entityId: paymentId,
      userId,
      metadata: { orderId, ...metadata }
    });
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(userId: string, action: 'LOGIN' | 'LOGOUT' | 'FAILED_LOGIN', metadata: Record<string, unknown>): Promise<void> {
    await this.log({
      action,
      entityType: 'AUTH',
      userId,
      metadata
    });
  }

  /**
   * Query audit events with filters
   */
  async query(filters: {
    action?: string;
    entityType?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditEvent[]> {
    try {
      const where: any = {};

      if (filters.action) where.eventType = { contains: filters.action.toUpperCase() };
      if (filters.entityType) where.eventType = { contains: filters.entityType.toUpperCase() };
      if (filters.userId) where.actorId = filters.userId;
      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }

      const events = await prisma.auditEvent.findMany({
        where,
        take: filters.limit || 100,
        orderBy: { createdAt: 'desc' }
      });

      return events.map((event: any) => {
        const payload = JSON.parse(event.payloadJson);
        return {
          action: payload.action,
          entityType: payload.entityType,
          entityId: payload.entityId,
          userId: event.actorId,
          metadata: payload.metadata,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent
        };
      });
    } catch (error) {
      console.error('Failed to query audit events:', error);
      return [];
    }
  }

  /**
   * Get audit statistics
   */
  async getStats(filters: {
    startDate?: Date;
    endDate?: Date;
    userId?: string;
  }): Promise<Record<string, number>> {
    try {
      const where: any = {};
      if (filters.userId) where.actorId = filters.userId;
      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }

      const events = await prisma.auditEvent.groupBy({
        by: ['eventType'],
        where,
        _count: {
          eventType: true
        },
        orderBy: {
          _count: {
            eventType: 'desc'
          }
        }
      });

      return events.reduce((acc: Record<string, number>, event: any) => {
        acc[event.eventType] = event._count.eventType;
        return acc;
      }, {} as Record<string, number>);
    } catch (error) {
      console.error('Failed to get audit stats:', error);
      return {};
    }
  }
}

// Singleton instance
export const auditTrail = new AuditTrail();
