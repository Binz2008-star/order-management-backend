import { beforeAll, describe, expect, it } from 'vitest'
import { POST as loginRoute } from '../app/api/auth/login/route'
import { GET as getSellerOrderRoute } from '../app/api/seller/orders/[id]/route'
import { GET as getSellerOrdersRoute } from '../app/api/seller/orders/route'
import { hashPassword } from '../server/lib/auth'
import { prisma } from './setup'
import { invokeRoute } from './helpers/route-invocation'

describe('Authorization API Tests', () => {
  let sellerAToken: string
  let sellerBToken: string
  let sellerAId: string
  let sellerBId: string

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
      body: { email, password },
    })
  }

  async function getSellerOrders(token?: string) {
    return invokeRoute<{ orders?: Array<{ id: string }>; error?: string }>(getSellerOrdersRoute, {
      url: 'http://test.local/api/seller/orders',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
  }

  async function getSellerOrder(id: string, authorization?: string) {
    return invokeRoute<{ order?: { id: string }; error?: string }, { id: string }>(getSellerOrderRoute, {
      url: `http://test.local/api/seller/orders/${id}`,
      headers: authorization ? { Authorization: authorization } : undefined,
      params: { id },
    })
  }

  beforeAll(async () => {
    // Clean up
    await prisma.orderEvent.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.product.deleteMany()
    await prisma.seller.deleteMany()
    await prisma.user.deleteMany()

    // Create Seller A
    const userA = await prisma.user.create({
      data: {
        email: `seller-a-${Date.now()}@example.com`,
        fullName: 'Seller A',
        passwordHash: await hashPassword('password123'),
        role: 'SELLER',
        isActive: true,
      },
    })

    const sellerA = await prisma.seller.create({
      data: {
        ownerUserId: userA.id,
        brandName: 'Store A',
        slug: 'store-a',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // Create Seller B
    const userB = await prisma.user.create({
      data: {
        email: `seller-b-${Date.now()}@example.com`,
        fullName: 'Seller B',
        passwordHash: await hashPassword('password123'),
        role: 'SELLER',
        isActive: true,
      },
    })

    const sellerB = await prisma.seller.create({
      data: {
        ownerUserId: userB.id,
        brandName: 'Store B',
        slug: 'store-b',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // Get tokens
    const authAResponse = await login(userA.email, 'password123')
    sellerAToken = authAResponse.body.token!

    const authBResponse = await login(userB.email, 'password123')
    sellerBToken = authBResponse.body.token!

    sellerAId = sellerA.id
    sellerBId = sellerB.id
  })

  it('should reject missing bearer token on seller routes', async () => {
    const response = await getSellerOrders()

    expect(response.status).toBe(401)
    expect(response.body.error).toBeDefined()
  })

  it('should reject invalid token', async () => {
    const response = await getSellerOrders('invalid-token')

    expect(response.status).toBe(401)
    expect(response.body.error).toBeDefined()
  })

  it('should reject token without Bearer prefix', async () => {
    const response = await getSellerOrder(sellerAId, sellerAToken)

    expect(response.status).toBe(401)
    expect(response.body.error).toBeDefined()
  })

  it('should reject wrong seller accessing another seller order', async () => {
    // Create an order for Seller B
    const customerB = await prisma.customer.create({
      data: {
        sellerId: sellerBId,
        name: 'Customer B',
        phone: '+0987654321',
        addressText: '456 B St',
      },
    })

    const orderB = await prisma.order.create({
      data: {
        sellerId: sellerBId,
        customerId: customerB.id,
        publicOrderNumber: 'ORD-B-TEST001',
        subtotalMinor: 2000,
        deliveryFeeMinor: 0,
        totalMinor: 2000,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
      },
    })

    // Seller A trying to access Seller B's order
    const response = await getSellerOrder(orderB.id, `Bearer ${sellerAToken}`)

    expect(response.status).toBe(404)
    expect(response.body.error).toBeDefined()
  })

  it('should allow seller to access own order', async () => {
    // Create an order for Seller A
    const customerA = await prisma.customer.create({
      data: {
        sellerId: sellerAId,
        name: 'Customer A',
        phone: '+1234567890',
        addressText: '123 A St',
      },
    })

    const orderA = await prisma.order.create({
      data: {
        sellerId: sellerAId,
        customerId: customerA.id,
        publicOrderNumber: 'ORD-A-TEST001',
        subtotalMinor: 1000,
        deliveryFeeMinor: 0,
        totalMinor: 1000,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
      },
    })

    const response = await getSellerOrder(orderA.id, `Bearer ${sellerAToken}`)

    expect(response.status).toBe(200)
    expect(response.body.order).toBeDefined()
    expect(response.body.order?.id).toBe(orderA.id)
  })

  it('should isolate seller orders lists', async () => {
    // Create orders for each seller
    const customerA = await prisma.customer.create({
      data: {
        sellerId: sellerAId,
        name: 'Customer A List',
        phone: '+11234567892',
        addressText: '124 Test A St',
      },
    })

    const orderA = await prisma.order.create({
      data: {
        sellerId: sellerAId,
        customerId: customerA.id,
        publicOrderNumber: 'ORD-A-LIST001',
        subtotalMinor: 1000,
        deliveryFeeMinor: 0,
        totalMinor: 1000,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
      },
    })

    const customerB = await prisma.customer.create({
      data: {
        sellerId: sellerBId,
        name: 'Customer B List',
        phone: '+09876543212',
        addressText: '456 Test B St',
      },
    })

    const orderB = await prisma.order.create({
      data: {
        sellerId: sellerBId,
        customerId: customerB.id,
        publicOrderNumber: 'ORD-B-LIST001',
        subtotalMinor: 2000,
        deliveryFeeMinor: 0,
        totalMinor: 2000,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
      },
    })

    // Seller A's orders list
    const responseA = await getSellerOrders(sellerAToken)

    expect(responseA.status).toBe(200)
    expect(responseA.body.orders).toHaveLength(1)
    expect(responseA.body.orders?.[0].id).toBe(orderA.id)

    // Seller B's orders list
    const responseB = await getSellerOrders(sellerBToken)

    expect(responseB.status).toBe(200)
    expect(responseB.body.orders).toHaveLength(1)
    expect(responseB.body.orders?.[0].id).toBe(orderB.id)
  })
})
