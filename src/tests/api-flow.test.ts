import bcrypt from 'bcryptjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { POST as loginRoute } from '../app/api/auth/login/route'
import { POST as createPublicOrderRoute } from '../app/api/public/[sellerSlug]/orders/route'
import { GET as getPublicProductsRoute } from '../app/api/public/[sellerSlug]/products/route'
import { GET as getSellerOrderRoute } from '../app/api/seller/orders/[id]/route'
import { PATCH as updateSellerOrderStatusRoute } from '../app/api/seller/orders/[id]/status/route'
import { GET as getSellerOrdersRoute } from '../app/api/seller/orders/route'
import { prisma } from './setup'
import { invokeRoute } from './helpers/route-invocation'

describe('API Flow Integration Tests', () => {
  let authToken: string
  let sellerId: string
  let orderId: string
  let productId: string
  const sellerSlug = 'demo-store'

  async function getPublicProducts() {
    return invokeRoute<{
      seller: { slug: string }
      products: Array<{ id: string }>
    }, { sellerSlug: string }>(getPublicProductsRoute, {
      url: `http://test.local/api/public/${sellerSlug}/products`,
      params: { sellerSlug },
    })
  }

  async function login(email: string, password: string) {
    return invokeRoute<{
      token?: string
      user?: {
        email: string
        role: string
        sellerId?: string
      }
      error?: string
    }>(loginRoute, {
      url: 'http://test.local/api/auth/login',
      method: 'POST',
      body: {
        email,
        password,
      },
    })
  }

  async function createPublicOrder(input: {
    customerName: string
    customerPhone: string
    addressText: string
    items: Array<{ productId: string; quantity: number }>
    deliveryFee: number
    paymentType: string
  }) {
    return invokeRoute<{
      id: string
      publicOrderNumber: string
      status: string
      items: Array<{ id: string }>
    }, { sellerSlug: string }>(createPublicOrderRoute, {
      url: `http://test.local/api/public/${sellerSlug}/orders`,
      method: 'POST',
      params: { sellerSlug },
      body: input,
    })
  }

  async function getSellerOrders(token: string) {
    return invokeRoute<{ orders: Array<{ id: string; publicOrderNumber: string; status: string }> }>(
      getSellerOrdersRoute,
      {
        url: 'http://test.local/api/seller/orders',
        headers: { Authorization: `Bearer ${token}` },
      }
    )
  }

  async function getSellerOrder(token: string, id: string) {
    return invokeRoute<{
      order: {
        id: string
        orderItems: Array<{ id: string }>
        events: Array<{ id: string }>
      }
    }, { id: string }>(getSellerOrderRoute, {
      url: `http://test.local/api/seller/orders/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      params: { id },
    })
  }

  async function updateSellerOrderStatus(token: string, id: string, status: string, reason: string) {
    return invokeRoute<{ order?: { status: string }; error?: string }, { id: string }>(
      updateSellerOrderStatusRoute,
      {
        url: `http://test.local/api/seller/orders/${id}/status`,
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: { id },
        body: {
          status,
          reason,
        },
      }
    )
  }

  beforeAll(async () => {
    // Create seed data for tests
    const passwordHash = await bcrypt.hash('demo123', 12)

    const user = await prisma.user.upsert({
      where: { email: 'demo@seller.com' },
      update: {
        fullName: 'Demo Seller',
        role: 'SELLER',
        isActive: true,
        passwordHash,
      },
      create: {
        email: 'demo@seller.com',
        fullName: 'Demo Seller',
        role: 'SELLER',
        isActive: true,
        passwordHash,
      },
    })

    const seller = await prisma.seller.upsert({
      where: { slug: 'demo-store' },
      update: {
        ownerUserId: user.id,
        brandName: 'Demo Store',
        whatsappNumber: '+1234567890',
        currency: 'USD',
        status: 'ACTIVE',
      },
      create: {
        ownerUserId: user.id,
        brandName: 'Demo Store',
        slug: 'demo-store',
        whatsappNumber: '+1234567890',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    const product = await prisma.product.upsert({
      where: {
        sellerId_slug: {
          sellerId: seller.id,
          slug: 'classic-tshirt',
        },
      },
      update: {
        name: 'Classic T-Shirt',
        description: 'Comfortable cotton t-shirt perfect for casual wear',
        priceMinor: 1999,
        currency: 'USD',
        stockQuantity: 50,
        isActive: true,
      },
      create: {
        sellerId: seller.id,
        name: 'Classic T-Shirt',
        slug: 'classic-tshirt',
        description: 'Comfortable cotton t-shirt perfect for casual wear',
        priceMinor: 1999,
        currency: 'USD',
        stockQuantity: 50,
        isActive: true,
      },
    })

    await prisma.customer.upsert({
      where: {
        sellerId_phone: {
          sellerId: seller.id,
          phone: '+11234567890',
        },
      },
      update: {
        name: 'John Doe',
        addressText: '123 Main St, Demo City, DC 12345',
      },
      create: {
        sellerId: seller.id,
        name: 'John Doe',
        phone: '+11234567890',
        addressText: '123 Main St, Demo City, DC 12345',
      },
    })

    sellerId = seller.id
    productId = product.id
  })

  it('should return 200 and non-empty array for public products', async () => {
    const response = await getPublicProducts()

    expect(response.status).toBe(200)
    expect(response.body.products).toBeDefined()
    expect(Array.isArray(response.body.products)).toBe(true)
    expect(response.body.products.length).toBeGreaterThan(0)
    expect(response.body.seller).toBeDefined()
    expect(response.body.seller.slug).toBe('demo-store')

    // Store product ID for later tests
    productId = response.body.products[0].id
  })

  it('should return token for demo user login', async () => {
    const response = await login('demo@seller.com', 'demo123')

    expect(response.status).toBe(200)
    expect(response.body.token).toBeDefined()
    expect(response.body.user).toBeDefined()
    expect(response.body.user?.email).toBe('demo@seller.com')
    expect(response.body.user?.role).toBe('SELLER')
    expect(response.body.user?.sellerId).toBeDefined()

    authToken = response.body.token!
    sellerId = response.body.user!.sellerId!
  })

  it('should create public order and return 201 with order ID', async () => {
    expect(productId).toBeDefined()

    // Recreate customer since it's deleted in beforeEach
    await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer',
        phone: '+1234567890',
        addressText: '123 Test St',
      },
    })

    const response = await createPublicOrder({
      customerName: 'Test Customer',
      customerPhone: '+1234567890',
      addressText: '123 Test St',
      items: [{ productId, quantity: 2 }],
      deliveryFee: 500,
      paymentType: 'CASH_ON_DELIVERY',
    })

    expect(response.status).toBe(201)
    expect(response.body.id).toBeDefined()
    expect(response.body.publicOrderNumber).toBeDefined()
    expect(response.body.status).toBe('PENDING')
    expect(response.body.items).toBeDefined()
    expect(Array.isArray(response.body.items)).toBe(true)
    expect(response.body.items.length).toBe(1)

    orderId = response.body.id

    // Verify DB state
    const orderCount = await prisma.order.count()
    const itemCount = await prisma.orderItem.count()
    const eventCount = await prisma.orderEvent.count()

    expect(orderCount).toBe(1)
    expect(itemCount).toBe(1)
    expect(eventCount).toBe(1)

    // Verify initial event
    const initialEvent = await prisma.orderEvent.findFirst({
      where: { orderId }
    })
    expect(initialEvent).toBeDefined()
    expect(initialEvent?.eventType).toBe('order_created')
  })

  it('should include created order in seller orders list', async () => {
    expect(authToken).toBeDefined()

    // Create a new order for this test since previous one was deleted
    await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 2',
        phone: '+1234567891',
        addressText: '124 Test St',
      },
    })

    const orderResponse = await createPublicOrder({
      customerName: 'Test Customer 2',
      customerPhone: '+1234567891',
      addressText: '124 Test St',
      items: [{ productId, quantity: 1 }],
      deliveryFee: 0,
      paymentType: 'CASH_ON_DELIVERY',
    })
    const testOrderId = orderResponse.body.id

    const response = await getSellerOrders(authToken)

    expect(response.status).toBe(200)
    expect(response.body.orders).toBeDefined()
    expect(Array.isArray(response.body.orders)).toBe(true)
    expect(response.body.orders.length).toBe(1)

    const order = response.body.orders[0]
    expect(order.id).toBe(testOrderId)
    expect(order.publicOrderNumber).toBeDefined()
    expect(order.status).toBe('PENDING')
  })

  it('should return correct order in seller order detail', async () => {
    expect(authToken).toBeDefined()

    // Create a new order for this test since previous one was deleted
    await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 3',
        phone: '+1234567892',
        addressText: '125 Test St',
      },
    })

    const orderResponse = await createPublicOrder({
      customerName: 'Test Customer 3',
      customerPhone: '+1234567892',
      addressText: '125 Test St',
      items: [{ productId, quantity: 1 }],
      deliveryFee: 0,
      paymentType: 'CASH_ON_DELIVERY',
    })
    const testOrderId = orderResponse.body.id

    const response = await getSellerOrder(authToken, testOrderId)

    expect(response.status).toBe(200)
    expect(response.body.order).toBeDefined()
    expect(response.body.order.id).toBe(testOrderId)
    expect(response.body.order.orderItems).toBeDefined()
    expect(Array.isArray(response.body.order.orderItems)).toBe(true)
    expect(response.body.order.orderItems.length).toBe(1)
    expect(response.body.order.events).toBeDefined()
    expect(Array.isArray(response.body.order.events)).toBe(true)
    expect(response.body.order.events.length).toBe(1)
  })

  it('should patch status to CONFIRMED successfully', async () => {
    expect(authToken).toBeDefined()

    // Create a new order for this test since previous one was deleted
    await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 4',
        phone: '+1234567893',
        addressText: '126 Test St',
      },
    })

    const orderResponse = await createPublicOrder({
      customerName: 'Test Customer 4',
      customerPhone: '+1234567893',
      addressText: '126 Test St',
      items: [{ productId, quantity: 1 }],
      deliveryFee: 0,
      paymentType: 'CASH_ON_DELIVERY',
    })
    const testOrderId = orderResponse.body.id

    const response = await updateSellerOrderStatus(
      authToken,
      testOrderId,
      'CONFIRMED',
      'Test confirmation'
    )

    expect(response.status).toBe(200)
    expect(response.body.order).toBeDefined()
    expect(response.body.order?.status).toBe('CONFIRMED')

    // Verify second event was created
    const eventCount = await prisma.orderEvent.count()
    expect(eventCount).toBe(2)

    const statusChangeEvent = await prisma.orderEvent.findFirst({
      where: {
        orderId: testOrderId,
        eventType: 'status_changed'
      }
    })
    expect(statusChangeEvent).toBeDefined()
    expect(statusChangeEvent?.actorUserId).toBeDefined()
  })

  it('should reject invalid status transition', async () => {
    expect(authToken).toBeDefined()

    // Create a new order for this test since previous one was deleted
    await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 5',
        phone: '+1234567894',
        addressText: '127 Test St',
      },
    })

    const orderResponse = await createPublicOrder({
      customerName: 'Test Customer 5',
      customerPhone: '+1234567894',
      addressText: '127 Test St',
      items: [{ productId, quantity: 1 }],
      deliveryFee: 0,
      paymentType: 'CASH_ON_DELIVERY',
    })
    const testOrderId = orderResponse.body.id

    // First confirm the order
    await updateSellerOrderStatus(authToken, testOrderId, 'CONFIRMED', 'Initial confirmation')

    // Try to transition from CONFIRMED to PENDING (invalid)
    const response = await updateSellerOrderStatus(
      authToken,
      testOrderId,
      'PENDING',
      'Invalid transition test'
    )

    expect(response.status).toBe(400)
    expect(response.body.error).toBeDefined()
  })
})
