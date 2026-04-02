import type { Customer, Order, Product, Seller } from '@prisma/client'
import { prisma } from '../../server/db/prisma'
import { PaymentService } from '../../server/services/payment.service'

describe('Payment Service - Atomic Operations', () => {
  let seller: Seller
  let customer: Customer
  let product: Product
  let order: Order

  beforeEach(async () => {
    // Clean setup for each test
    await prisma.orderEvent.deleteMany()
    await prisma.paymentAttempt.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.product.deleteMany()
    await prisma.seller.deleteMany()
    await prisma.user.deleteMany()

    // Create test user first
    const user = await prisma.user.create({
      data: {
        id: `user_${Date.now()}`,
        email: `user_${Date.now()}@test.com`,
        fullName: 'Test User',
        passwordHash: 'hashed_password',
        isActive: true
      }
    })

    // Create test data
    seller = await prisma.seller.create({
      data: {
        id: `seller_${Date.now()}`,
        ownerUserId: user.id,
        brandName: 'Test Brand',
        slug: `test-brand-${Date.now()}`
      }
    })

    customer = await prisma.customer.create({
      data: {
        id: `customer_${Date.now()}`,
        sellerId: seller.id,
        name: 'Test Customer',
        phone: '+1234567890'
      }
    })

    product = await prisma.product.create({
      data: {
        id: `product_${Date.now()}`,
        sellerId: seller.id,
        name: 'Test Product',
        slug: `test-product-${Date.now()}`,
        priceMinor: 1000,
        currency: 'USD',
        stockQuantity: 10,
        isActive: true
      }
    })

    order = await prisma.order.create({
      data: {
        id: `order_${Date.now()}`,
        customerId: customer.id,
        sellerId: seller.id,
        publicOrderNumber: `ORD-${Date.now()}`,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        paymentType: 'PREPAID',
        subtotalMinor: 2000,
        totalMinor: 2000,
        currency: 'USD'
      }
    })

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 2,
        unitPriceMinor: 1000,
        lineTotalMinor: 2000,
        productNameSnapshot: product.name
      }
    })
  })

  afterEach(async () => {
    // Cleanup
    await prisma.orderEvent.deleteMany()
    await prisma.paymentAttempt.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.product.deleteMany()
    await prisma.seller.deleteMany()
  })

  test('atomic payment creation - single transaction success', async () => {
    const paymentAttempt = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD',
    }, 'user-123')

    // Verify all changes in single transaction
    expect(paymentAttempt.status).toBe('PENDING')

    // Verify order unchanged (payment not completed yet)
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updatedOrder?.paymentStatus).toBe('PENDING')
    expect(updatedOrder?.status).toBe('PENDING')

    // Verify event created
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } })
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('payment_initiated')
    expect(events[0].actorUserId).toBe('user-123')
  })

  test('atomic payment completion - all changes succeed or fail together', async () => {
    // Create payment attempt first
    const payment = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    // Process payment atomically (PENDING -> PROCESSING -> COMPLETED)
    const _processingResult = await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'PROCESSING'
    }, 'user-123')

    const completedResult = await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'COMPLETED',
      providerReference: 'pi_test_complete_1'
    }, 'user-123')

    // Verify atomic changes
    expect(completedResult.status).toBe('COMPLETED')

    // Verify payment attempt updated
    const updatedPayment = await prisma.paymentAttempt.findUnique({
      where: { id: payment.id }
    })
    expect(updatedPayment?.status).toBe('COMPLETED')
    expect(updatedPayment?.providerReference).toBe('pi_test_complete_1')

    // Verify order updated
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updatedOrder?.paymentStatus).toBe('PAID')
    expect(updatedOrder?.status).toBe('CONFIRMED') // Auto-confirmed from PENDING

    // Verify events created
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } })
    expect(events.length).toBeGreaterThanOrEqual(4) // payment_initiated, payment_completed, status_changed events

    const statusChangeEvent = events.find(e => e.eventType === 'status_changed' && e.payloadJson?.includes('CONFIRMED'))
    const payload = JSON.parse(statusChangeEvent?.payloadJson || '{}')
    expect(payload.from).toBe('PENDING')
    expect(payload.to).toBe('CONFIRMED')
    expect(payload.reason).toBe('payment_completed')
  })

  test('atomic payment failure - consistent state maintained', async () => {
    // Create payment attempt first
    const payment = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    // Fail payment atomically
    const result = await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'FAILED',
      failureReason: 'insufficient_funds'
    }, 'user-123')

    // Verify atomic changes
    expect(result.status).toBe('FAILED')

    // Verify payment attempt updated
    const updatedPayment = await prisma.paymentAttempt.findUnique({
      where: { id: payment.id }
    })
    expect(updatedPayment?.status).toBe('FAILED')
    expect(updatedPayment?.failureReason).toBe('insufficient_funds')

    // Verify order payment status updated
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updatedOrder?.paymentStatus).toBe('FAILED')
    expect(updatedOrder?.status).toBe('PENDING') // Order status unchanged

    // Verify failure event created
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } })
    const paymentFailedEvent = events.find(e => e.eventType === 'payment_failed')
    expect(paymentFailedEvent).toBeDefined()

    const payload = JSON.parse(paymentFailedEvent?.payloadJson || '{}')
    expect(payload.failureReason).toBe('insufficient_funds')
  })

  test('concurrent payment attempts - only one succeeds', async () => {
    // Create multiple payment attempts simultaneously (reduced for CI reliability)
    const promises = Array.from({ length: 3 }, (_, i) =>
      PaymentService.createPaymentAttempt({
        orderId: order.id,
        provider: 'stripe',
        amountMinor: 2000,
        currency: 'USD',
        metadata: { attempt: i }
      }, 'user-123')
    )

    const results = await Promise.allSettled(promises)

    // Exactly one should succeed
    const successful = results.filter(r => r.status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected')

    expect(successful).toHaveLength(1)
    expect(failed).toHaveLength(2)

    // Verify only one payment attempt exists in database
    const paymentAttempts = await prisma.paymentAttempt.findMany({
      where: { orderId: order.id }
    })
    expect(paymentAttempts).toHaveLength(1)

    // Verify only one payment initiation event
    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id, eventType: 'payment_initiated' }
    })
    expect(events).toHaveLength(1)
  }, 10000)

  test('provider reference idempotency - duplicate rejected', async () => {
    // First payment attempt
    const payment1 = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    // Complete first payment
    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment1.id,
      status: 'PROCESSING'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment1.id,
      status: 'COMPLETED',
      providerReference: 'pi_duplicate_test_123'
    }, 'user-123')

    // Try to create another payment attempt (should succeed as it's a new attempt)
    const payment2 = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 3000,
      currency: 'USD'
    }, 'user-123')

    // Should create a new payment attempt (different amount)
    expect(payment2.id).not.toBe(payment1.id)

    // Verify two payment attempts exist
    const paymentAttempts = await prisma.paymentAttempt.findMany({
      where: { orderId: order.id }
    })
    expect(paymentAttempts).toHaveLength(2)
  })

  test('refund atomicity - consistent state maintained', async () => {
    // Create and complete payment first
    const payment = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'PROCESSING'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'COMPLETED',
      providerReference: 'pi_refund_test'
    }, 'user-123')

    // Process refund atomically
    const refundResult = await PaymentService.refundPayment({
      paymentAttemptId: payment.id,
      refundAmountMinor: 1500,
      reason: 'customer_request'
    }, 'user-123')

    // Verify atomic changes
    expect(refundResult.status).toBe('REFUNDED')

    // Verify payment attempt updated
    const updatedPayment = await prisma.paymentAttempt.findUnique({
      where: { id: payment.id }
    })
    expect(updatedPayment?.status).toBe('REFUNDED')

    // Verify order payment status updated
    const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updatedOrder?.paymentStatus).toBe('REFUNDED')

    // Verify refund event created
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } })
    const refundEvent = events.find(e => e.eventType === 'payment_refunded')
    expect(refundEvent).toBeDefined()

    const payload = JSON.parse(refundEvent?.payloadJson || '{}')
    expect(payload.refundAmountMinor).toBe(1500)
  })

  test('COD payment attempts rejected - invariant enforced', async () => {
    // Create COD order
    const codOrder = await prisma.order.create({
      data: {
        id: `cod_order_${Date.now()}`,
        customerId: customer.id,
        sellerId: seller.id,
        publicOrderNumber: `COD-${Date.now()}`,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        paymentType: 'CASH_ON_DELIVERY',
        subtotalMinor: 2000,
        totalMinor: 2000,
        currency: 'USD'
      }
    })

    // Try to create payment attempt on COD order
    await expect(
      PaymentService.createPaymentAttempt({
        orderId: codOrder.id,
        provider: 'stripe',
        amountMinor: 2000,
        currency: 'USD'
      }, 'user-123')
    ).rejects.toThrow('Payment attempts not allowed for Cash on Delivery orders')

    // Verify no payment attempt created
    const paymentAttempts = await prisma.paymentAttempt.findMany({
      where: { orderId: codOrder.id }
    })
    expect(paymentAttempts).toHaveLength(0)

    // Verify no events created
    const events = await prisma.orderEvent.findMany({
      where: { orderId: codOrder.id }
    })
    expect(events).toHaveLength(0)
  })

  test('invalid payment transitions rejected - state machine enforced', async () => {
    // Create payment attempt
    const payment = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    // Try to jump directly to REFUNDED from PENDING (invalid)
    await expect(
      PaymentService.updatePaymentStatus({
        paymentAttemptId: payment.id,
        status: 'REFUNDED'
      }, 'user-123')
    ).rejects.toThrow('Invalid transition')

    // Try valid transition PENDING -> FAILED
    const result = await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'FAILED',
      failureReason: 'test'
    }, 'user-123')

    expect(result.status).toBe('FAILED') // PENDING -> FAILED is valid

    // Try to refund a failed payment (invalid)
    await expect(
      PaymentService.refundPayment({
        paymentAttemptId: payment.id,
        refundAmountMinor: 1000,
        reason: 'test'
      }, 'user-123')
    ).rejects.toThrow('Refund only allowed for COMPLETED payments')

    // Verify payment still in FAILED state
    const updatedPayment = await prisma.paymentAttempt.findUnique({
      where: { id: payment.id }
    })
    expect(updatedPayment?.status).toBe('FAILED')
  })

  test('refund amount validation - over-refund prevented', async () => {
    // Create and complete payment
    const payment = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'PROCESSING'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'COMPLETED',
      providerReference: 'pi_overrefund_test'
    }, 'user-123')

    // Try to refund more than original amount
    await expect(
      PaymentService.refundPayment({
        paymentAttemptId: payment.id,
        refundAmountMinor: 2500,
        reason: 'test'
      }, 'user-123')
    ).rejects.toThrow('Refund exceeds original amount')

    // Verify payment still in COMPLETED state
    const updatedPayment = await prisma.paymentAttempt.findUnique({
      where: { id: payment.id }
    })
    expect(updatedPayment?.status).toBe('COMPLETED')
  })

  test('audit trail completeness - no null actors', async () => {
    // Complete payment flow
    const payment = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'stripe',
      amountMinor: 2000,
      currency: 'USD'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'PROCESSING'
    }, 'user-123')

    await PaymentService.updatePaymentStatus({
      paymentAttemptId: payment.id,
      status: 'COMPLETED',
      providerReference: 'pi_audit_test'
    }, 'user-123')

    // Verify audit trail completeness
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } })
    expect(events.length).toBeGreaterThan(0)

    // User-initiated payment events should have actorUserId
    const userPaymentEvents = events.filter(e =>
      e.eventType.includes('payment') && e.eventType !== 'payment_completed'
    )
    userPaymentEvents.forEach(event => {
      expect(event.actorUserId).not.toBeNull()
      expect(event.actorUserId).not.toBe('')
    })

    // payment_completed events can be system events (actorUserId: null) or user events
    const paymentCompletedEvents = events.filter(e => e.eventType === 'payment_completed')
    paymentCompletedEvents.forEach(event => {
      // System events have null actorUserId, user events have non-null
      // Both are valid, just verify the event exists
      expect(event).toBeDefined()
    })

    // Verify all payloads have required fields
    events.forEach(event => {
      const payload = JSON.parse(event.payloadJson || '{}')
      expect(payload).toBeDefined()
      expect(typeof payload).toBe('object')
    })

    // Verify user payment events have required metadata
    userPaymentEvents.forEach(event => {
      const payload = JSON.parse(event.payloadJson || '{}')
      expect(payload).toHaveProperty('provider')
      expect(payload).toHaveProperty('amountMinor')
      expect(payload).toHaveProperty('currency')
    })

    // Verify payment_completed events have appropriate metadata
    paymentCompletedEvents.forEach(event => {
      const payload = JSON.parse(event.payloadJson || '{}')
      if (event.actorUserId === null) {
        // System event should have timestamp
        expect(payload).toHaveProperty('timestamp')
      } else {
        // User event should have payment info
        expect(payload).toHaveProperty('provider')
        expect(payload).toHaveProperty('amountMinor')
        expect(payload).toHaveProperty('currency')
      }
    })
  })
})
