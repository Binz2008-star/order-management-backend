import bcrypt from 'bcryptjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from './setup'

describe('API Flow Integration Tests', () => {
  let authToken: string
  let sellerId: string
  let orderId: string
  let productId: string

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

    const customer = await prisma.customer.upsert({
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
    const response = await fetch('http://localhost:3000/api/public/demo-store/products')
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.products).toBeDefined()
    expect(Array.isArray(data.products)).toBe(true)
    expect(data.products.length).toBeGreaterThan(0)
    expect(data.seller).toBeDefined()
    expect(data.seller.slug).toBe('demo-store')

    // Store product ID for later tests
    productId = data.products[0].id
  })

  it('should return token for demo user login', async () => {
    const response = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo@seller.com',
        password: 'demo123'
      })
    })

    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.token).toBeDefined()
    expect(data.user).toBeDefined()
    expect(data.user.email).toBe('demo@seller.com')
    expect(data.user.role).toBe('SELLER')
    expect(data.user.sellerId).toBeDefined()

    authToken = data.token
    sellerId = data.user.sellerId
  })

  it('should create public order and return 201 with order ID', async () => {
    expect(productId).toBeDefined()

    // Recreate customer since it's deleted in beforeEach
    const customer = await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer',
        phone: '+1234567890',
        addressText: '123 Test St',
      },
    })

    const response = await fetch('http://localhost:3000/api/public/demo-store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Customer',
        customerPhone: '+1234567890',
        addressText: '123 Test St',
        items: [{ productId, quantity: 2 }],
        deliveryFee: 500,
        paymentType: 'CASH_ON_DELIVERY'
      })
    })

    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBeDefined()
    expect(data.publicOrderNumber).toBeDefined()
    expect(data.status).toBe('PENDING')
    expect(data.items).toBeDefined()
    expect(Array.isArray(data.items)).toBe(true)
    expect(data.items.length).toBe(1)

    orderId = data.id

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
    const customer = await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 2',
        phone: '+1234567891',
        addressText: '124 Test St',
      },
    })

    const orderResponse = await fetch('http://localhost:3000/api/public/demo-store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Customer 2',
        customerPhone: '+1234567891',
        addressText: '124 Test St',
        items: [{ productId, quantity: 1 }],
        deliveryFee: 0,
        paymentType: 'CASH_ON_DELIVERY'
      })
    })

    const orderData = await orderResponse.json()
    const testOrderId = orderData.id

    const response = await fetch('http://localhost:3000/api/seller/orders', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })

    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.orders).toBeDefined()
    expect(Array.isArray(data.orders)).toBe(true)
    expect(data.orders.length).toBe(1)

    const order = data.orders[0]
    expect(order.id).toBe(testOrderId)
    expect(order.publicOrderNumber).toBeDefined()
    expect(order.status).toBe('PENDING')
  })

  it('should return correct order in seller order detail', async () => {
    expect(authToken).toBeDefined()

    // Create a new order for this test since previous one was deleted
    const customer = await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 3',
        phone: '+1234567892',
        addressText: '125 Test St',
      },
    })

    const orderResponse = await fetch('http://localhost:3000/api/public/demo-store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Customer 3',
        customerPhone: '+1234567892',
        addressText: '125 Test St',
        items: [{ productId, quantity: 1 }],
        deliveryFee: 0,
        paymentType: 'CASH_ON_DELIVERY'
      })
    })

    const orderData = await orderResponse.json()
    const testOrderId = orderData.id

    const response = await fetch(`http://localhost:3000/api/seller/orders/${testOrderId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })

    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.order).toBeDefined()
    expect(data.order.id).toBe(testOrderId)
    expect(data.order.orderItems).toBeDefined()
    expect(Array.isArray(data.order.orderItems)).toBe(true)
    expect(data.order.orderItems.length).toBe(1)
    expect(data.order.events).toBeDefined()
    expect(Array.isArray(data.order.events)).toBe(true)
    expect(data.order.events.length).toBe(1)
  })

  it('should patch status to CONFIRMED successfully', async () => {
    expect(authToken).toBeDefined()

    // Create a new order for this test since previous one was deleted
    const customer = await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 4',
        phone: '+1234567893',
        addressText: '126 Test St',
      },
    })

    const orderResponse = await fetch('http://localhost:3000/api/public/demo-store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Customer 4',
        customerPhone: '+1234567893',
        addressText: '126 Test St',
        items: [{ productId, quantity: 1 }],
        deliveryFee: 0,
        paymentType: 'CASH_ON_DELIVERY'
      })
    })

    const orderData = await orderResponse.json()
    const testOrderId = orderData.id

    const response = await fetch(`http://localhost:3000/api/seller/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'CONFIRMED',
        reason: 'Test confirmation'
      })
    })

    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.order).toBeDefined()
    expect(data.order.status).toBe('CONFIRMED')

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
    const customer = await prisma.customer.create({
      data: {
        sellerId,
        name: 'Test Customer 5',
        phone: '+1234567894',
        addressText: '127 Test St',
      },
    })

    const orderResponse = await fetch('http://localhost:3000/api/public/demo-store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Customer 5',
        customerPhone: '+1234567894',
        addressText: '127 Test St',
        items: [{ productId, quantity: 1 }],
        deliveryFee: 0,
        paymentType: 'CASH_ON_DELIVERY'
      })
    })

    const orderData = await orderResponse.json()
    const testOrderId = orderData.id

    // First confirm the order
    await fetch(`http://localhost:3000/api/seller/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'CONFIRMED',
        reason: 'Initial confirmation'
      })
    })

    // Try to transition from CONFIRMED to PENDING (invalid)
    const response = await fetch(`http://localhost:3000/api/seller/orders/${testOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'PENDING',
        reason: 'Invalid transition test'
      })
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })
})
