import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toApiError } from '../server/http/api-error'
import { orderService } from '../server/services/order.service'
import { prisma } from './setup'

describe('Transaction Timeout Error Handling', () => {
  beforeEach(async () => {
    await prisma.orderEvent.deleteMany()
    await prisma.paymentAttempt.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.product.deleteMany()
    await prisma.seller.deleteMany()
    await prisma.user.deleteMany()
  })

  it('should map Prisma transaction timeout errors to HTTP 503', () => {
    // Test direct transaction timeout error
    const timeoutError = new Error('Transaction timeout')
    const apiError = toApiError(timeoutError)

    expect(apiError.statusCode).toBe(503)
    expect(apiError.code).toBe('TRANSACTION_TIMEOUT')
    expect(apiError.message).toBe('Transaction timeout')
  })

  it('should map Prisma connection errors to HTTP 503', () => {
    // Test connection error
    const connectionError = new Error('Prisma known request: connection timeout')
    const apiError = toApiError(connectionError)

    expect(apiError.statusCode).toBe(503)
    expect(apiError.code).toBe('DATABASE_UNAVAILABLE')
    expect(apiError.message).toBe('Database temporarily unavailable')
  })

  it('should map generic Prisma known request errors to HTTP 503', () => {
    // Test generic known request error
    const knownRequestError = new Error('Prisma known request: database locked')
    const apiError = toApiError(knownRequestError)

    expect(apiError.statusCode).toBe(503)
    expect(apiError.code).toBe('DATABASE_UNAVAILABLE')
    expect(apiError.message).toBe('Database temporarily unavailable')
  })

  it('should preserve other error types', () => {
    // Test that other errors are not affected
    const genericError = new Error('Some other error')
    const apiError = toApiError(genericError)

    expect(apiError.statusCode).toBe(500)
    expect(apiError.code).toBe('INTERNAL_ERROR')
    expect(apiError.message).toBe('Internal server error')
  })

  it('should use 15000ms timeout in order creation transaction', async () => {
    // Create test data
    const user = await prisma.user.create({
      data: {
        email: `seller-${Date.now()}@example.com`,
        fullName: 'Test Seller',
        passwordHash: await (await import('bcryptjs')).hash('password', 12),
        role: 'SELLER',
        isActive: true,
      },
    })

    const seller = await prisma.seller.create({
      data: {
        ownerUserId: user.id,
        brandName: 'Test Store',
        slug: 'test-store',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    const product = await prisma.product.create({
      data: {
        sellerId: seller.id,
        name: 'Test Product',
        slug: 'test-product',
        priceMinor: 1999,
        currency: 'USD',
        stockQuantity: 100,
        isActive: true,
      },
    })

    const customer = await prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'Test Customer',
        phone: '+1234567890',
        addressText: '123 Test St',
      },
    })

    // Mock prisma.$transaction to verify timeout parameter
    const capturedOptions: any[] = []

    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((callback: any, options: any) => {
      capturedOptions.push(options)
      // Create a simple mock transaction that just calls the callback with a mock tx
      const mockTx = {
        product: {
          findFirst: vi.fn().mockResolvedValue({
            id: product.id,
            name: product.name,
            priceMinor: product.priceMinor,
            stockQuantity: product.stockQuantity
          }),
          update: vi.fn().mockResolvedValue({ stockQuantity: 99 })
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: 'test-order-id',
            sellerId: seller.id,
            customerId: customer.id,
            publicOrderNumber: 'ORD-TEST-123',
            status: 'PENDING',
            paymentStatus: 'PENDING',
            subtotalMinor: 1999,
            totalMinor: 1999,
            currency: 'USD'
          }),
          count: vi.fn().mockResolvedValue(0)
        },
        orderItem: {
          createMany: vi.fn().mockResolvedValue({ count: 1 })
        },
        orderEvent: {
          create: vi.fn().mockResolvedValue({
            id: 'test-event-id',
            orderId: 'test-order-id',
            eventType: 'order_created'
          })
        }
      }

      // Call the callback with our mock transaction
      return callback(mockTx)
    })

    try {
      // Test order creation with timeout
      await orderService.createOrder({
        sellerId: seller.id,
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        currency: 'USD',
        paymentType: 'CASH_ON_DELIVERY'
      })

      expect(spy).toHaveBeenCalled()
      expect(capturedOptions).toHaveLength(1)
      expect(capturedOptions[0]?.timeout).toBe(15000)
      expect(capturedOptions[0]?.maxWait).toBe(5000)
    } finally {
      // Restore original method
      spy.mockRestore()
    }
  })
})
