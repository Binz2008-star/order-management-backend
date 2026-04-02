import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { logger } from '../lib/logger'
import { PaymentGuards } from '../lib/payment-guards'
import { OrderEventService } from './order-event.service'

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

export interface CreatePaymentAttemptData {
  orderId: string
  provider: string
  amountMinor: number
  currency: string
  providerReference?: string
  metadata?: Record<string, unknown>
}

export interface PaymentResult {
  paymentAttempt: PaymentAttempt
  orderStatus: string
  paymentStatus: string
}

export interface RefundResult {
  paymentAttempt: PaymentAttempt
  refundAmountMinor: number
  paymentStatus: string
}

export interface PaymentAttempt {
  id: string
  orderId: string
  provider: string
  providerReference?: string | null
  amountMinor: number
  currency: string
  status: string // Prisma returns string, not enum
  failureReason?: string | null
  metadataJson?: string | null
  rawPayloadJson?: string | null
  createdAt: Date
  updatedAt: Date
}

export class PaymentService {
  /**
   * Create a new payment attempt with atomic transaction
   */
  static async createPaymentAttempt(
    data: CreatePaymentAttemptData,
    actorUserId: string
  ): Promise<PaymentAttempt> {
    return await prisma.$transaction(async (tx) => {
      // 1. LOCK ORDER (prevents concurrent attempts)
      const order = await tx.order.findUnique({
        where: { id: data.orderId },
        include: { paymentAttempts: true }
      })

      if (!order) {
        throw new Error('Order not found')
      }

      // 2. ENFORCE INVARIANTS
      PaymentGuards.rejectCODPaymentAttempts({
        orderId: data.orderId,
        paymentType: order.paymentType,
        currentPaymentStatus: order.paymentStatus
      })

      PaymentGuards.preventDuplicatePaymentAttempts(
        order.paymentAttempts,
        data.orderId
      )

      // 3. CHECK IDEMPOTENCY for provider reference
      if (data.providerReference) {
        const existing = await this.checkIdempotency(
          data.provider,
          data.providerReference
        )

        if (existing) {
          return existing
        }
      }

      // 4. CREATE PAYMENT ATTEMPT
      const paymentAttempt = await tx.paymentAttempt.create({
        data: {
          orderId: data.orderId,
          provider: data.provider,
          providerReference: data.providerReference || null,
          amountMinor: data.amountMinor,
          currency: data.currency,
          status: 'PENDING',
          failureReason: null,
          metadataJson: data.metadata ? JSON.stringify(data.metadata) : null
        }
      })

      // 5. MANDATORY EVENT CREATION
      await OrderEventService.createPaymentEvent(
        tx,
        data.orderId,
        actorUserId,
        'PAYMENT_INITIATED',
        {
          provider: data.provider,
          amountMinor: data.amountMinor,
          currency: data.currency
        }
      )

      logger.info('Payment attempt created', {
        paymentAttemptId: paymentAttempt.id,
        orderId: data.orderId,
        provider: data.provider,
        amountMinor: data.amountMinor,
      })

      return paymentAttempt as PaymentAttempt
    })
  }

  /**
   * Complete payment with atomic transaction
   */
  static async completePayment(
    paymentAttemptId: string,
    providerReference: string,
    actorUserId: string
  ): Promise<PaymentResult> {
    return await prisma.$transaction(async (tx) => {
      // 1. LOCK PAYMENT ATTEMPT
      const paymentAttempt = await tx.paymentAttempt.findUnique({
        where: { id: paymentAttemptId },
        include: { order: true }
      })

      if (!paymentAttempt) {
        throw new Error('Payment attempt not found')
      }

      // 2. ENFORCE STATE TRANSITION
      PaymentGuards.enforcePaymentStateTransition(
        paymentAttempt.status,
        'COMPLETED'
      )

      // 3. CHECK IDEMPOTENCY
      if (providerReference) {
        const existing = await tx.paymentAttempt.findFirst({
          where: {
            provider: paymentAttempt.provider,
            providerReference,
            status: 'COMPLETED'
          }
        })

        if (existing && existing.id !== paymentAttemptId) {
          throw new Error(`Provider reference ${providerReference} already used`)
        }
      }

      // 4. UPDATE PAYMENT ATTEMPT
      const updatedPayment = await tx.paymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          status: 'COMPLETED',
          providerReference,
          updatedAt: new Date()
        }
      })

      // 5. UPDATE ORDER PAYMENT STATUS
      await tx.order.update({
        where: { id: paymentAttempt.orderId },
        data: { paymentStatus: 'PAID' }
      })

      let finalOrderStatus = paymentAttempt.order.status

      // 6. AUTO-CONFIRM PENDING ORDERS
      if (paymentAttempt.order.status === 'PENDING') {
        await tx.order.update({
          where: { id: paymentAttempt.orderId },
          data: { status: 'CONFIRMED' }
        })

        // 7. MANDATORY STATUS CHANGE EVENT
        await OrderEventService.createStatusChangeEvent(
          tx,
          paymentAttempt.orderId,
          actorUserId,
          'PENDING',
          'CONFIRMED',
          'Payment completed'
        )

        finalOrderStatus = 'CONFIRMED'
      }

      // 8. MANDATORY PAYMENT EVENT
      await OrderEventService.createPaymentEvent(
        tx,
        paymentAttempt.orderId,
        actorUserId,
        'PAYMENT_CONFIRMED',
        {
          provider: paymentAttempt.provider,
          amountMinor: paymentAttempt.amountMinor,
          currency: paymentAttempt.currency,
          providerReference
        }
      )

      logger.info('Payment completed', {
        paymentAttemptId,
        providerReference,
        orderId: paymentAttempt.orderId,
      })

      return {
        paymentAttempt: updatedPayment as PaymentAttempt,
        orderStatus: finalOrderStatus,
        paymentStatus: 'PAID'
      }
    })
  }

  /**
   * Fail payment with atomic transaction
   */
  static async failPayment(
    paymentAttemptId: string,
    failureReason: string,
    actorUserId: string
  ): Promise<PaymentResult> {
    return await prisma.$transaction(async (tx) => {
      // 1. LOCK PAYMENT ATTEMPT
      const paymentAttempt = await tx.paymentAttempt.findUnique({
        where: { id: paymentAttemptId },
        include: { order: true }
      })

      if (!paymentAttempt) {
        throw new Error('Payment attempt not found')
      }

      // 2. ENFORCE STATE TRANSITION
      PaymentGuards.enforcePaymentStateTransition(
        paymentAttempt.status,
        'FAILED'
      )

      // 3. UPDATE PAYMENT ATTEMPT
      const updatedPayment = await tx.paymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          status: 'FAILED',
          updatedAt: new Date()
        }
      })

      // 4. UPDATE ORDER PAYMENT STATUS
      await tx.order.update({
        where: { id: paymentAttempt.orderId },
        data: { paymentStatus: 'FAILED' }
      })

      // 5. MANDATORY PAYMENT EVENT
      await OrderEventService.createPaymentEvent(
        tx,
        paymentAttempt.orderId,
        actorUserId,
        'PAYMENT_FAILED',
        {
          provider: paymentAttempt.provider,
          amountMinor: paymentAttempt.amountMinor,
          currency: paymentAttempt.currency,
          failureReason
        }
      )

      logger.info('Payment failed', {
        paymentAttemptId,
        failureReason,
        orderId: paymentAttempt.orderId,
      })

      return {
        paymentAttempt: updatedPayment as PaymentAttempt,
        orderStatus: paymentAttempt.order.status,
        paymentStatus: 'FAILED'
      }
    })
  }

  /**
   * Refund payment with atomic transaction
   */
  static async refundPayment(
    paymentAttemptId: string,
    refundAmountMinor: number,
    reason: string,
    actorUserId: string
  ): Promise<RefundResult> {
    return await prisma.$transaction(async (tx) => {
      // 1. LOCK PAYMENT ATTEMPT
      const paymentAttempt = await tx.paymentAttempt.findUnique({
        where: { id: paymentAttemptId },
        include: { order: true }
      })

      if (!paymentAttempt) {
        throw new Error('Payment attempt not found')
      }

      // 2. ENFORCE REFUND RULES
      PaymentGuards.preventRefundOnNonCompletedPayment(paymentAttempt.status)
      PaymentGuards.validateRefundAmount(
        refundAmountMinor,
        paymentAttempt.amountMinor
      )

      // 3. UPDATE PAYMENT ATTEMPT
      const updatedPayment = await tx.paymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          status: 'REFUNDED',
          updatedAt: new Date()
        }
      })

      // Store refund metadata separately or add to rawPayloadJson if needed
      if (paymentAttempt.rawPayloadJson) {
        const existingPayload = JSON.parse(paymentAttempt.rawPayloadJson)
        await tx.paymentAttempt.update({
          where: { id: paymentAttemptId },
          data: {
            rawPayloadJson: JSON.stringify({
              ...existingPayload,
              refundAmountMinor,
              refundReason: reason,
              refundDate: new Date().toISOString()
            })
          }
        })
      }

      // 4. UPDATE ORDER PAYMENT STATUS
      await tx.order.update({
        where: { id: paymentAttempt.orderId },
        data: { paymentStatus: 'REFUNDED' }
      })

      // 5. MANDATORY REFUND EVENT
      await OrderEventService.createPaymentEvent(
        tx,
        paymentAttempt.orderId,
        actorUserId,
        'PAYMENT_REFUNDED',
        {
          provider: paymentAttempt.provider,
          amountMinor: refundAmountMinor,
          currency: paymentAttempt.currency
        }
      )

      logger.info('Payment refunded', {
        paymentAttemptId,
        refundAmountMinor,
        reason,
        orderId: paymentAttempt.orderId,
      })

      return {
        paymentAttempt: updatedPayment as PaymentAttempt,
        refundAmountMinor,
        paymentStatus: 'REFUNDED'
      }
    })
  }

  /**
   * Check idempotency by provider reference
   */
  static async checkIdempotency(
    provider: string,
    providerReference: string
  ): Promise<PaymentAttempt | null> {
    return await prisma.paymentAttempt.findFirst({
      where: {
        provider,
        providerReference,
        status: 'COMPLETED'
      }
    }) as PaymentAttempt | null
  }

  /**
   * Get payment attempts for an order
   */
  static async getOrderPaymentAttempts(orderId: string) {
    return await prisma.paymentAttempt.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            publicOrderNumber: true,
            status: true,
            paymentStatus: true,
          }
        }
      }
    })
  }

  /**
   * Get payment attempt by ID
   */
  static async getPaymentAttempt(paymentAttemptId: string) {
    return await prisma.paymentAttempt.findUnique({
      where: { id: paymentAttemptId },
      include: {
        order: {
          include: {
            customer: true,
            orderItems: true,
          }
        }
      }
    })
  }

  /**
   * Get payment statistics for a seller (read-only operation)
   */
  static async getSellerPaymentStats(sellerId: string, startDate?: Date, endDate?: Date) {
    const where: Prisma.PaymentAttemptWhereInput = {
      order: { sellerId },
    }

    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = startDate
      if (endDate) where.createdAt.lte = endDate
    }

    const attempts = await prisma.paymentAttempt.findMany({
      where,
      include: {
        order: {
          select: {
            totalMinor: true,
            currency: true,
          }
        }
      }
    })

    const stats = attempts.reduce((acc, attempt) => {
      acc.totalAttempts++
      acc.totalAmountMinor += attempt.amountMinor

      switch (attempt.status) {
        case 'COMPLETED':
          acc.completedPayments++
          acc.completedAmountMinor += attempt.amountMinor
          break
        case 'FAILED':
          acc.failedPayments++
          break
        case 'REFUNDED':
          acc.refundedPayments++
          acc.refundedAmountMinor += attempt.amountMinor
          break
      }

      return acc
    }, {
      totalAttempts: 0,
      totalAmountMinor: 0,
      completedPayments: 0,
      completedAmountMinor: 0,
      failedPayments: 0,
      refundedPayments: 0,
      refundedAmountMinor: 0,
    })

    return stats
  }
}
