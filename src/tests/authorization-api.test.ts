import { beforeAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../server/lib/auth'
import { prisma } from './setup'

describe('Authorization API Tests', () => {
  let sellerAToken: string
  let sellerBToken: string
  let sellerAId: string
  let sellerBId: string

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
    const authAResponse = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userA.email,
        password: 'password123'
      })
    })
    const authA = await authAResponse.json()
    sellerAToken = authA.token

    const authBResponse = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userB.email,
        password: 'password123'
      })
    })
    const authB = await authBResponse.json()
    sellerBToken = authB.token

    sellerAId = sellerA.id
    sellerBId = sellerB.id
  })

  it('should reject missing bearer token on seller routes', async () => {
    const response = await fetch('http://localhost:3000/api/seller/orders')

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })

  it('should reject invalid token', async () => {
    const response = await fetch('http://localhost:3000/api/seller/orders', {
      headers: { 'Authorization': 'Bearer invalid-token' }
    })

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBeDefined()
  })

  it('should reject token without Bearer prefix', async () => {
    const response = await fetch('http://localhost:3000/api/seller/orders', {
      headers: { 'Authorization': sellerAToken }
    })

    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBeDefined()
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
    const response = await fetch(`http://localhost:3000/api/seller/orders/${orderB.id}`, {
      headers: { 'Authorization': `Bearer ${sellerAToken}` }
    })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBeDefined()
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

    const response = await fetch(`http://localhost:3000/api/seller/orders/${orderA.id}`, {
      headers: { 'Authorization': `Bearer ${sellerAToken}` }
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.order).toBeDefined()
    expect(data.order.id).toBe(orderA.id)
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
    const responseA = await fetch('http://localhost:3000/api/seller/orders', {
      headers: { 'Authorization': `Bearer ${sellerAToken}` }
    })

    expect(responseA.status).toBe(200)
    const dataA = await responseA.json()
    expect(dataA.orders).toHaveLength(1)
    expect(dataA.orders[0].id).toBe(orderA.id)

    // Seller B's orders list
    const responseB = await fetch('http://localhost:3000/api/seller/orders', {
      headers: { 'Authorization': `Bearer ${sellerBToken}` }
    })

    expect(responseB.status).toBe(200)
    const dataB = await responseB.json()
    expect(dataB.orders).toHaveLength(1)
    expect(dataB.orders[0].id).toBe(orderB.id)
  })
})
