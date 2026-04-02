import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { generatePublicOrderNumber, calculateOrderTotal } from '../src/server/lib/utils'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding (idempotent, transactional)...')

  await prisma.$transaction(async (tx) => {
    // 1. User
    const user = await tx.user.upsert({
      where: { email: 'demo@seller.com' },
      update: {},
      create: {
        email: 'demo@seller.com',
        fullName: 'Demo Seller',
        role: 'SELLER',
        isActive: true,
        passwordHash: await bcrypt.hash('demo123', 10),
      },
    })

    // 2. Seller
    const seller = await tx.seller.upsert({
      where: { slug: 'demo-store' },
      update: {},
      create: {
        ownerUserId: user.id,
        brandName: 'Demo Store',
        slug: 'demo-store',
        whatsappNumber: '+1234567890',
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    // 3. Products (idempotent)
    const productsData = [
      { name: 'Classic T-Shirt', slug: 'classic-tshirt', priceMinor: 1999 },
      { name: 'Denim Jeans', slug: 'denim-jeans', priceMinor: 4999 },
      { name: 'Canvas Sneakers', slug: 'canvas-sneakers', priceMinor: 3499 },
    ]

    const products = []
    for (const p of productsData) {
      const product = await tx.product.upsert({
        where: {
          sellerId_slug: { sellerId: seller.id, slug: p.slug },
        },
        update: {},
        create: {
          ...p,
          sellerId: seller.id,
          currency: 'USD',
          stockQuantity: 50,
          isActive: true,
        },
      })
      products.push(product)
    }

    // 4. Customer
    const customer = await tx.customer.upsert({
      where: {
        sellerId_phone: {
          sellerId: seller.id,
          phone: '+11234567890',
        },
      },
      update: {},
      create: {
        sellerId: seller.id,
        name: 'John Doe',
        phone: '+11234567890',
      },
    })

    // 5. Order (derived totals — no hardcoding)
    const items = [
      { product: products[0], quantity: 2 }, // 2 x T-Shirt = 3998
      { product: products[1], quantity: 1 }, // 1 x Jeans = 4999
    ]

    const totals = calculateOrderTotal(
      items.map(i => ({
        unitPriceMinor: i.product.priceMinor,
        quantity: i.quantity,
      })),
      500 // delivery fee
    )

    const order = await tx.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: generatePublicOrderNumber(),
        ...totals,
        currency: 'USD',
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
        paymentType: 'CASH',
        source: 'WEBSITE',
      },
    })

    // 6. Order items
    await tx.orderItem.createMany({
      data: items.map(i => ({
        orderId: order.id,
        productId: i.product.id,
        productNameSnapshot: i.product.name,
        unitPriceMinor: i.product.priceMinor,
        quantity: i.quantity,
        lineTotalMinor: i.product.priceMinor * i.quantity,
      })),
    })

    // 7. REQUIRED: Order event
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'ORDER_CREATED',
        payloadJson: JSON.stringify({
          source: 'WEBSITE',
          itemCount: items.length,
        }),
      },
    })

    // 8. Create a second order for testing
    const items2 = [
      { product: products[2], quantity: 1 }, // 1 x Sneakers = 3499
    ]

    const totals2 = calculateOrderTotal(
      items2.map(i => ({
        unitPriceMinor: i.product.priceMinor,
        quantity: i.quantity,
      })),
      300 // delivery fee
    )

    const order2 = await tx.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: generatePublicOrderNumber(),
        ...totals2,
        currency: 'USD',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        paymentType: 'CASH',
        source: 'WEBSITE',
      },
    })

    // 9. Order items for second order
    await tx.orderItem.createMany({
      data: items2.map(i => ({
        orderId: order2.id,
        productId: i.product.id,
        productNameSnapshot: i.product.name,
        unitPriceMinor: i.product.priceMinor,
        quantity: i.quantity,
        lineTotalMinor: i.product.priceMinor * i.quantity,
      })),
    })

    // 10. Order event for second order
    await tx.orderEvent.create({
      data: {
        orderId: order2.id,
        eventType: 'ORDER_CREATED',
        payloadJson: JSON.stringify({
          source: 'WEBSITE',
          itemCount: items2.length,
        }),
      },
    })
  })

  console.log('✅ Seed completed')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
