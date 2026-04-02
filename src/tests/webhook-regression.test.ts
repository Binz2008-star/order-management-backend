import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../src/server/db/prisma'
import { PaymentService } from '../../src/server/services/payment.service'

describe('Stripe Webhook Event Enforcement Regression Tests', () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.paymentAttempt.deleteMany()
    await prisma.order.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.seller.deleteMany()
    await prisma.user.deleteMany()
  })

  async function createTestOrder(status: string = 'PENDING') {
    // Create test user and seller
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'SELLER',
        isActive: true,
        passwordHash: 'test',
      },
    })

    const seller = await prisma.seller.create({
      data: {
        ownerUserId: user.id,
        brandName: 'Test Store',
        slug: 'test-store',
        whatsappNumber: '+1234567890',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // Create customer
    const customer = await prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'Test Customer',
        phone: '+1234567890',
      },
    })

    // Create a test order
    return await prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: 'TEST-001',
        subtotalMinor: 1000,
        totalMinor: 1000,
        currency: 'USD',
        status,
        paymentStatus: 'PENDING',
        paymentType: 'CASH',
        source: 'TEST',
      },
    })
  }

  describe('Payment Confirmation Idempotency', () => {
    it('should handle duplicate Stripe completion webhooks idempotently', async () => {
      const order = await createTestOrder()

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Confirm payment first time
      const result1 = await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_123',
        rawPayload: { id: 'pi_test_123', status: 'succeeded' },
      })

      // Confirm payment second time (duplicate webhook)
      const result2 = await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_123',
        rawPayload: { id: 'pi_test_123', status: 'succeeded' },
      })

      // Both should return the same result
      expect(result1.id).toBe(result2.id)
      expect(result1.status).toBe('COMPLETED')
      expect(result2.status).toBe('COMPLETED')

      // Verify order status only updated once
      const finalOrder = await prisma.order.findUnique({
        where: { id: order.id },
      })
      expect(finalOrder?.status).toBe('CONFIRMED')
      expect(finalOrder?.paymentStatus).toBe('PAID')

      // Verify payment_completed event created only once
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      })
      const paymentCompletedEvents = events.filter(e => e.eventType === 'payment_completed')
      expect(paymentCompletedEvents.length).toBe(1)

      // Verify status_changed event created only once
      const statusChangedEvents = await prisma.orderEvent.findMany({
        where: {
          orderId: order.id,
          eventType: 'status_changed'
        },
      })
      expect(statusChangedEvents.length).toBe(1)
    })

    it('should update payment status exactly once', async () => {
      const order = await createTestOrder()

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Get initial payment status
      const initialOrder = await prisma.order.findUnique({
        where: { id: order.id },
      })
      expect(initialOrder?.paymentStatus).toBe('PENDING')

      // Confirm payment
      await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_456',
        rawPayload: { id: 'pi_test_456', status: 'succeeded' },
      })

      // Verify payment status updated exactly once
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      })
      expect(updatedOrder?.paymentStatus).toBe('PAID')

      // Verify payment attempt status updated exactly once
      const updatedAttempt = await prisma.paymentAttempt.findUnique({
        where: { id: paymentAttempt.id },
      })
      expect(updatedAttempt?.status).toBe('COMPLETED')
    })
  })

  describe('Order State Transition Rules', () => {
    it('should allow PENDING order to confirm when payment completed', async () => {
      const order = await createTestOrder('PENDING')

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Confirm payment
      await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_789',
        rawPayload: { id: 'pi_test_789', status: 'succeeded' },
      })

      // Verify order transitioned to CONFIRMED
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      })
      expect(updatedOrder?.status).toBe('CONFIRMED')
      expect(updatedOrder?.paymentStatus).toBe('PAID')
    })

    it('should not regress PACKED order status when payment completed', async () => {
      const order = await createTestOrder('PACKED')

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Confirm payment
      await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_abc',
        rawPayload: { id: 'pi_test_abc', status: 'succeeded' },
      })

      // Verify order status remains PACKED (no regression)
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      })
      expect(updatedOrder?.status).toBe('PACKED') // Should remain PACKED
      expect(updatedOrder?.paymentStatus).toBe('PAID')
    })

    it('should not regress OUT_FOR_DELIVERY order status when payment completed', async () => {
      const order = await createTestOrder('OUT_FOR_DELIVERY')

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Confirm payment
      await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_def',
        rawPayload: { id: 'pi_test_def', status: 'succeeded' },
      })

      // Verify order status remains OUT_FOR_DELIVERY (no regression)
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      })
      expect(updatedOrder?.status).toBe('OUT_FOR_DELIVERY') // Should remain OUT_FOR_DELIVERY
      expect(updatedOrder?.paymentStatus).toBe('PAID')
    })
  })

  describe('Event Creation Integrity', () => {
    it('should create payment_completed event exactly once', async () => {
      const order = await createTestOrder()

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Confirm payment
      await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_ghi',
        rawPayload: { id: 'pi_test_ghi', status: 'succeeded' },
      })

      // Verify payment_completed event created exactly once
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      })
      const paymentCompletedEvents = events.filter(e => e.eventType === 'payment_completed')
      expect(paymentCompletedEvents.length).toBe(1)

      // Verify event payload is truthful
      const event = paymentCompletedEvents[0]
      expect(event.actorUserId).toBeNull() // System event
      expect(event.payloadJson).toContain('timestamp')
    })

    it('should create events in correct order with truthful data', async () => {
      const order = await createTestOrder()

      // Create a payment attempt
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Confirm payment
      await PaymentService.confirmPayment({
        paymentAttemptId: paymentAttempt.id,
        provider: 'STRIPE',
        providerReference: 'pi_test_jkl',
        rawPayload: { id: 'pi_test_jkl', status: 'succeeded' },
      })

      // Verify all events created in correct order
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      })

      expect(events.length).toBe(3)
      expect(events[0].eventType).toBe('payment_initiated')
      expect(events[1].eventType).toBe('payment_completed')
      expect(events[2].eventType).toBe('status_changed')

      // Verify status_changed event payload is truthful
      const statusChangeEvent = events[2]
      const payload = JSON.parse(statusChangeEvent.payloadJson || '{}')
      expect(payload.from).toBe('PENDING')
      expect(payload.to).toBe('CONFIRMED')
      expect(payload.reason).toBe('payment_completed')
    })
  })

  describe('Error Cases and Edge Cases', () => {
    it('should reject payment confirmation for non-existent payment attempt', async () => {
      await expect(
        PaymentService.confirmPayment({
          paymentAttemptId: 'non-existent-id',
          provider: 'STRIPE',
          providerReference: 'pi_test_error',
          rawPayload: { id: 'pi_test_error', status: 'succeeded' },
        })
      ).rejects.toThrow('Payment attempt not found')
    })

    it('should reject payment confirmation with provider mismatch', async () => {
      const order = await createTestOrder()

      // Create a payment attempt with STRIPE provider
      const paymentAttempt = await PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'STRIPE',
        amountMinor: 1000,
        currency: 'USD',
      })

      // Try to confirm with different provider
      await expect(
        PaymentService.confirmPayment({
          paymentAttemptId: paymentAttempt.id,
          provider: 'PAYPAL',
          providerReference: 'pi_test_mismatch',
          rawPayload: { id: 'pi_test_mismatch', status: 'succeeded' },
        })
      ).rejects.toThrow('Provider mismatch')
    })
  })
})
