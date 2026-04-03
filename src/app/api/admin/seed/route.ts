import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { NextRequest, NextResponse } from 'next/server'

// Inline implementations to avoid import issues
function generatePublicOrderNumber(): string {
  return `ORD-${nanoid(8).toUpperCase()}`
}

const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    // Enhanced security: Require proper admin seed token
    if (process.env.NODE_ENV === 'production') {
      const seedToken = process.env.ADMIN_SEED_TOKEN
      if (!seedToken) {
        console.error('❌ ADMIN_SEED_TOKEN not configured in production')
        return NextResponse.json({
          error: 'Seed endpoint not properly configured'
        }, { status: 500 })
      }

      const authHeader = request.headers.get('authorization')
      if (!authHeader?.startsWith('Bearer ') || authHeader.substring(7) !== seedToken) {
        console.warn('🚨 Unauthorized seed attempt', {
          hasHeader: !!authHeader,
          headerLength: authHeader?.length || 0
        })
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

    // 5. Sample Order with proper business logic
    const orderItems = [
      { productId: products[0].id, quantity: 2 }
    ]

    // Create order using proper transaction with business logic
    const _order = await prisma.$transaction(async (tx) => {
      // Validate products and stock (business logic)
      const validatedItems = []

      for (const item of orderItems) {
        const product = await tx.product.findFirst({
          where: {
            id: item.productId,
            sellerId: seller.id,
            isActive: true
          }
        })

        if (!product) {
          throw new Error(`Product ${item.productId} not found or inactive`)
        }

        if (product.stockQuantity < item.quantity) {
          throw new Error(`Insufficient stock for product ${product.name}`)
        }

        // Update stock with proper concurrency handling
        const stockUpdate = await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: { decrement: item.quantity }
          }
        })

        // Verify stock was sufficient (handles race condition)
        if (stockUpdate.stockQuantity < 0) {
          throw new Error(`Insufficient stock for product ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}`)
        }

        const unitPriceMinor = product.priceMinor
        const lineTotalMinor = unitPriceMinor * item.quantity

        validatedItems.push({
          productId: item.productId,
          productNameSnapshot: product.name,
          unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor
        })
      }

      // Calculate totals inline (temporary fix for import issue)
      const deliveryFeeMinor = 500
      const subtotalMinor = validatedItems.reduce((sum, item) => sum + item.lineTotalMinor, 0)
      const totals = {
        subtotalMinor,
        deliveryFeeMinor,
        totalMinor: subtotalMinor + deliveryFeeMinor
      }

      // Create order
      const newOrder = await tx.order.create({
        data: {
          sellerId: seller.id,
          customerId: customer.id,
          publicOrderNumber: generatePublicOrderNumber(),
          status: 'PENDING',
          paymentType: 'CASH_ON_DELIVERY',
          paymentStatus: 'PENDING',
          ...totals, // Use calculated totals
          currency: 'USD',
          source: 'SEED_SCRIPT',
          notes: 'Sample order from production seeding'
        }
      })

      // Create order items
      const orderItemsWithOrderId = validatedItems.map(item => ({
        ...item,
        orderId: newOrder.id
      }))
      await tx.orderItem.createMany({
        data: orderItemsWithOrderId
      })

      // Create proper event sequence
      await tx.orderEvent.create({
        data: {
          orderId: newOrder.id,
          eventType: 'ORDER_CREATED',
          payloadJson: JSON.stringify({
            source: 'SEED_SCRIPT',
            itemCount: validatedItems.length,
            subtotalMinor,
            totalMinor: subtotalMinor + 500
          })
        }
      })

      await tx.orderEvent.create({
        data: {
          orderId: newOrder.id,
          eventType: 'STATUS_CHANGED',
          payloadJson: JSON.stringify({
            from: 'PENDING',
            to: 'CONFIRMED',
            reason: 'AUTO_CONFIRMED_FROM_SEED',
            actorUserId: adminUser.id
          })
        }
      })

      // Update order status to CONFIRMED
      await tx.order.update({
        where: { id: newOrder.id },
        data: { status: 'CONFIRMED' }
      })

      return newOrder
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
