import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { calculateOrderTotal, generatePublicOrderNumber } from '../../../../server/lib/utils'

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    // Security: In production, add proper authentication/authorization
    if (process.env.NODE_ENV === 'production') {
      const authHeader = request.headers.get('authorization')
      if (!authHeader?.startsWith('Bearer admin-seed-token')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    console.log('🌱 Production seeding started...')

    // Check if already seeded
    const existingUser = await prisma.user.findUnique({
      where: { email: 'admin@company.com' }
    })

    if (existingUser) {
      return NextResponse.json({
        message: 'Database already seeded',
        user: { email: existingUser.email, role: existingUser.role }
      })
    }

    // 1. Admin User
    const adminUser = await prisma.user.create({
      data: {
        email: 'admin@company.com',
        fullName: 'System Administrator',
        role: 'ADMIN',
        isActive: true,
        passwordHash: await bcrypt.hash('admin123!@#', 12),
      },
    })

    // 2. Demo Seller
    const sellerUser = await prisma.user.create({
      data: {
        email: 'demo@seller.com',
        fullName: 'Demo Seller',
        role: 'SELLER',
        isActive: true,
        passwordHash: await bcrypt.hash('demo123', 12),
      },
    })

    const seller = await prisma.seller.create({
      data: {
        ownerUserId: sellerUser.id,
        brandName: 'Demo Store',
        slug: 'demo-store',
        whatsappNumber: '+1234567890',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // 3. Sample Products
    const products = await Promise.all([
      prisma.product.create({
        data: {
          sellerId: seller.id,
          name: 'Classic T-Shirt',
          slug: 'classic-tshirt',
          description: 'Comfortable cotton t-shirt',
          priceMinor: 1999,
          currency: 'USD',
          stockQuantity: 100,
          isActive: true,
        },
      }),
      prisma.product.create({
        data: {
          sellerId: seller.id,
          name: 'Denim Jeans',
          slug: 'denim-jeans',
          description: 'Classic blue denim jeans',
          priceMinor: 4999,
          currency: 'USD',
          stockQuantity: 50,
          isActive: true,
        },
      }),
    ])

    // 4. Sample Customer
    const customer = await prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'John Doe',
        phone: '+11234567890',
      },
    })

    // 5. Sample Order
    const items = [
      { product: products[0], quantity: 2 },
    ]

    const totals = calculateOrderTotal(
      items.map(i => ({
        unitPriceMinor: i.product.priceMinor,
        quantity: i.quantity,
      })),
      500
    )

    const order = await prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: generatePublicOrderNumber(),
        ...totals,
        currency: 'USD',
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
        paymentType: 'CASH_ON_DELIVERY',
        source: 'WEBSITE',
      },
    })

    await prisma.orderItem.createMany({
      data: items.map(i => ({
        orderId: order.id,
        productId: i.product.id,
        productNameSnapshot: i.product.name,
        unitPriceMinor: i.product.priceMinor,
        quantity: i.quantity,
        lineTotalMinor: i.product.priceMinor * i.quantity,
      })),
    })

    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'ORDER_CREATED',
        payloadJson: JSON.stringify({
          source: 'WEBSITE',
          itemCount: items.length,
        }),
      },
    })

    console.log('✅ Production seeding completed')

    return NextResponse.json({
      message: 'Database seeded successfully',
      created: {
        admin: { email: adminUser.email, role: adminUser.role },
        seller: {
          user: { email: sellerUser.email, role: sellerUser.role },
          seller: { brandName: seller.brandName, slug: seller.slug }
        },
        products: products.length,
        orders: 1
      }
    })

  } catch (error) {
    console.error('❌ Production seeding failed:', error)
    return NextResponse.json({
      error: 'Seeding failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
