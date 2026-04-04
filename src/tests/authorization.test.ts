import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { authenticateUser, getCurrentUser, hashPassword } from '../server/lib/auth'
import { prisma } from './setup'

describe('Authorization - Seller Isolation', () => {
  let sellerA: {
    id: string
    brandName: string
    slug: string
    currency: string
    status: string
  }
  let sellerB: {
    id: string
    brandName: string
    slug: string
    currency: string
    status: string
  }
  let sellerAToken: string
  let sellerBToken: string
  let sellerAOrder: {
    id: string
    publicOrderNumber: string
    sellerId: string
  }
  let sellerBOrder: {
    id: string
    publicOrderNumber: string
    sellerId: string
  }

  beforeEach(async () => {
    // Clean all data
    await prisma.orderEvent.deleteMany()
    await prisma.paymentAttempt.deleteMany()
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

    sellerA = await prisma.seller.create({
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

    sellerB = await prisma.seller.create({
      data: {
        ownerUserId: userB.id,
        brandName: 'Store B',
        slug: 'store-b',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // Generate tokens
    const authA = await authenticateUser(userA.email, 'password123')
    const authB = await authenticateUser(userB.email, 'password123')
    sellerAToken = authA.token
    sellerBToken = authB.token

    // Create orders for each seller
    const customerA = await prisma.customer.create({
      data: {
        sellerId: sellerA.id,
        name: 'Customer A',
        phone: '+1234567890',
        addressText: '123 A St',
      },
    })

    const customerB = await prisma.customer.create({
      data: {
        sellerId: sellerB.id,
        name: 'Customer B',
        phone: '+0987654321',
        addressText: '456 B St',
      },
    })

    sellerAOrder = await prisma.order.create({
      data: {
        sellerId: sellerA.id,
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

    sellerBOrder = await prisma.order.create({
      data: {
        sellerId: sellerB.id,
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
  })

  describe('Seller A Access', () => {
    it('should access own orders', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: `Bearer ${sellerAToken}`,
        },
      })

      const user = await getCurrentUser(request)
      expect(user.sellerId).toBe(sellerA.id)

      const orders = await prisma.order.findMany({
        where: { sellerId: sellerA.id },
      })

      expect(orders).toHaveLength(1)
      expect(orders[0].id).toBe(sellerAOrder.id)
      expect(orders[0].publicOrderNumber).toBe('ORD-A-TEST001')
    })

    it('should not access Seller B orders', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: `Bearer ${sellerAToken}`,
        },
      })

      const user = await getCurrentUser(request)

      // This should only return Seller A's orders
      const sellerBOrders = await prisma.order.findMany({
        where: { sellerId: sellerB.id },
      })

      expect(sellerBOrders).toHaveLength(1)
      expect(sellerBOrders[0].id).toBe(sellerBOrder.id)

      // But Seller A should not be able to access them
      const sellerAOrders = await prisma.order.findMany({
        where: { sellerId: user.sellerId! },
      })

      expect(sellerAOrders).toHaveLength(1)
      expect(sellerAOrders[0].id).toBe(sellerAOrder.id)
      expect(sellerAOrders[0].id).not.toBe(sellerBOrder.id)
    })
  })

  describe('Seller B Access', () => {
    it('should access own orders', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: `Bearer ${sellerBToken}`,
        },
      })

      const user = await getCurrentUser(request)
      expect(user.sellerId).toBe(sellerB.id)

      const orders = await prisma.order.findMany({
        where: { sellerId: sellerB.id },
      })

      expect(orders).toHaveLength(1)
      expect(orders[0].id).toBe(sellerBOrder.id)
      expect(orders[0].publicOrderNumber).toBe('ORD-B-TEST001')
    })

    it('should not access Seller A orders', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: `Bearer ${sellerBToken}`,
        },
      })

      const user = await getCurrentUser(request)

      const sellerAOrders = await prisma.order.findMany({
        where: { sellerId: sellerA.id },
      })

      expect(sellerAOrders).toHaveLength(1)
      expect(sellerAOrders[0].id).toBe(sellerAOrder.id)

      // But Seller B should not be able to access them
      const sellerBOrders = await prisma.order.findMany({
        where: { sellerId: user.sellerId! },
      })

      expect(sellerBOrders).toHaveLength(1)
      expect(sellerBOrders[0].id).toBe(sellerBOrder.id)
      expect(sellerBOrders[0].id).not.toBe(sellerAOrder.id)
    })
  })

  describe('Token Security', () => {
    it('should reject invalid seller token', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      })

      await expect(getCurrentUser(request)).rejects.toThrow('Invalid token')
    })

    it('should reject token without Bearer prefix', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: sellerAToken,
        },
      })

      await expect(getCurrentUser(request)).rejects.toThrow('No token provided')
    })

    it('should reject empty token', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders', {
        headers: {
          Authorization: 'Bearer ',
        },
      })

      await expect(getCurrentUser(request)).rejects.toThrow('No token provided')
    })

    it('should reject request without authorization header', async () => {
      const request = new NextRequest('http://localhost:3000/api/seller/orders')

      await expect(getCurrentUser(request)).rejects.toThrow('No token provided')
    })
  })

  describe('Cross-Seller Data Protection', () => {
    it('should ensure sellers can only access their own customers', async () => {
      const sellerACustomers = await prisma.customer.findMany({
        where: { sellerId: sellerA.id },
      })

      const sellerBCustomers = await prisma.customer.findMany({
        where: { sellerId: sellerB.id },
      })

      expect(sellerACustomers).toHaveLength(1)
      expect(sellerBCustomers).toHaveLength(1)
      expect(sellerACustomers[0].sellerId).toBe(sellerA.id)
      expect(sellerBCustomers[0].sellerId).toBe(sellerB.id)
      expect(sellerACustomers[0].id).not.toBe(sellerBCustomers[0].id)
    })

    it('should ensure sellers can only access their own products', async () => {
      // Create products for each seller
      await prisma.product.create({
        data: {
          sellerId: sellerA.id,
          name: 'Product A',
          slug: 'product-a',
          priceMinor: 1000,
          currency: 'USD',
          stockQuantity: 10,
          isActive: true,
        },
      })

      await prisma.product.create({
        data: {
          sellerId: sellerB.id,
          name: 'Product B',
          slug: 'product-b',
          priceMinor: 2000,
          currency: 'USD',
          stockQuantity: 20,
          isActive: true,
        },
      })

      const sellerAProducts = await prisma.product.findMany({
        where: { sellerId: sellerA.id },
      })

      const sellerBProducts = await prisma.product.findMany({
        where: { sellerId: sellerB.id },
      })

      expect(sellerAProducts).toHaveLength(1)
      expect(sellerBProducts).toHaveLength(1)
      expect(sellerAProducts[0].sellerId).toBe(sellerA.id)
      expect(sellerBProducts[0].sellerId).toBe(sellerB.id)
      expect(sellerAProducts[0].id).not.toBe(sellerBProducts[0].id)
    })
  })
})
