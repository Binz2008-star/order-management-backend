import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../src/server/db/prisma'
import { PaymentService } from '../../src/server/services/payment.service'

describe('PaymentService.confirmPayment', () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.paymentAttempt.deleteMany()
    await prisma.order.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.seller.deleteMany()
    await prisma.user.deleteMany()
  })

  it('should confirm payment and create events', async () => {
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
    const order = await prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: 'TEST-001',
        subtotalMinor: 1000,
        totalMinor: 1000,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        paymentType: 'CASH',
        source: 'TEST',
      },
    })

    // Create a payment attempt
    const paymentAttempt = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'STRIPE',
      amountMinor: 1000,
      currency: 'USD',
    }, 'test-user')

    // Confirm payment
    const confirmedPayment = await PaymentService.confirmPayment({
      paymentAttemptId: paymentAttempt.id,
      provider: 'STRIPE',
      providerReference: 'pi_test_123',
      rawPayload: { id: 'pi_test_123', status: 'succeeded' },
    })

    expect(confirmedPayment.status).toBe('COMPLETED')
    expect(confirmedPayment.providerReference).toBe('pi_test_123')

    // Verify order was updated
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    })
    expect(updatedOrder?.status).toBe('CONFIRMED')
    expect(updatedOrder?.paymentStatus).toBe('PAID')

    // Verify events were created
    const events = await prisma.orderEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    })

    console.log('Events created:', events.map(e => ({ type: e.eventType, payload: e.payloadJson })))
    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.eventType === 'payment_completed')).toBe(true)
    expect(events.some(e => e.eventType === 'status_changed')).toBe(true)
  })

  it('should be idempotent - duplicate confirmations should not duplicate effects', async () => {
    // Create test user and seller
    const user = await prisma.user.create({
      data: {
        email: 'test2@example.com',
        fullName: 'Test User 2',
        role: 'SELLER',
        isActive: true,
        passwordHash: 'test',
      },
    })

    const seller = await prisma.seller.create({
      data: {
        ownerUserId: user.id,
        brandName: 'Test Store 2',
        slug: 'test-store-2',
        whatsappNumber: '+1234567890',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // Create customer
    const customer = await prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'Test Customer 2',
        phone: '+1234567890',
      },
    })

    // Create a test order
    const order = await prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: 'TEST-002',
        subtotalMinor: 1000,
        totalMinor: 1000,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        paymentType: 'CASH',
        source: 'TEST',
      },
    })

    // Create a payment attempt
    const paymentAttempt = await PaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'STRIPE',
      amountMinor: 1000,
      currency: 'USD',
    }, 'test-user')

    // Confirm payment first time
    const result1 = await PaymentService.confirmPayment({
      paymentAttemptId: paymentAttempt.id,
      provider: 'STRIPE',
      providerReference: 'pi_test_456',
      rawPayload: { id: 'pi_test_456', status: 'succeeded' },
    })

    // Confirm payment second time (duplicate)
    const result2 = await PaymentService.confirmPayment({
      paymentAttemptId: paymentAttempt.id,
      provider: 'STRIPE',
      providerReference: 'pi_test_456',
      rawPayload: { id: 'pi_test_456', status: 'succeeded' },
    })

    // Both should return the same result
    expect(result1.id).toBe(result2.id)
    expect(result1.status).toBe('COMPLETED')
    expect(result2.status).toBe('COMPLETED')

    // Verify events were not duplicated
    const paymentCompletedEvents = await prisma.orderEvent.findMany({
      where: {
        orderId: order.id,
        eventType: 'payment_completed'
      },
    })

    // Should only have one payment_completed event
    expect(paymentCompletedEvents.length).toBe(1)
  })
})
