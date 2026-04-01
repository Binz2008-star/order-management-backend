import { PrismaClient } from '@prisma/client'
import { generatePublicOrderNumber } from '../src/server/lib/utils'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seeding...')

  // Create demo user
  const user = await prisma.user.create({
    data: {
      email: 'demo@seller.com',
      fullName: 'Demo Seller',
      role: 'SELLER',
      isActive: true,
    },
  })

  // Create demo seller
  const seller = await prisma.seller.create({
    data: {
      ownerUserId: user.id,
      brandName: 'Demo Store',
      slug: 'demo-store',
      whatsappNumber: '+1234567890',
      currency: 'USD',
      status: 'ACTIVE',
    },
  })

  // Create demo products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: 'Classic T-Shirt',
        slug: 'classic-tshirt',
        description: 'Comfortable cotton t-shirt in various colors',
        priceMinor: 1999, // $19.99
        currency: 'USD',
        stockQuantity: 50,
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: 'Denim Jeans',
        slug: 'denim-jeans',
        description: 'Classic fit denim jeans',
        priceMinor: 4999, // $49.99
        currency: 'USD',
        stockQuantity: 30,
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: 'Canvas Sneakers',
        slug: 'canvas-sneakers',
        description: 'Comfortable canvas sneakers for everyday wear',
        priceMinor: 3499, // $34.99
        currency: 'USD',
        stockQuantity: 25,
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: 'Leather Wallet',
        slug: 'leather-wallet',
        description: 'Genuine leather bifold wallet',
        priceMinor: 2999, // $29.99
        currency: 'USD',
        stockQuantity: 15,
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        sellerId: seller.id,
        name: 'Sunglasses',
        slug: 'sunglasses',
        description: 'UV protection sunglasses with stylish frame',
        priceMinor: 2499, // $24.99
        currency: 'USD',
        stockQuantity: 20,
        isActive: true,
      },
    }),
  ])

  // Create demo customers
  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'John Doe',
        phone: '+11234567890',
        addressText: '123 Main St, City, State 12345',
      },
    }),
    prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'Jane Smith',
        phone: '+10987654321',
        addressText: '456 Oak Ave, Town, State 67890',
      },
    }),
    prisma.customer.create({
      data: {
        sellerId: seller.id,
        name: 'Bob Johnson',
        phone: '+15551234567',
        addressText: '789 Pine Rd, Village, State 11111',
      },
    }),
  ])

  // Create demo orders
  const orders = await Promise.all([
    prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customers[0].id,
        publicOrderNumber: generatePublicOrderNumber(),
        subtotalMinor: 5497, // 2 * $19.99 + 1 * $34.99
        deliveryFeeMinor: 500, // $5.00
        totalMinor: 5997, // $59.97
        currency: 'USD',
        notes: 'Please wrap as a gift',
        source: 'demo_seed',
        status: 'CONFIRMED',
        paymentStatus: 'PENDING',
      },
    }),
    prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customers[1].id,
        publicOrderNumber: generatePublicOrderNumber(),
        subtotalMinor: 7998, // 1 * $49.99 + 1 * $29.99
        deliveryFeeMinor: 500, // $5.00
        totalMinor: 8498, // $84.98
        currency: 'USD',
        notes: 'Delivery preferred after 5 PM',
        source: 'demo_seed',
        status: 'PACKED',
        paymentStatus: 'PENDING',
      },
    }),
    prisma.order.create({
      data: {
        sellerId: seller.id,
        customerId: customers[2].id,
        publicOrderNumber: generatePublicOrderNumber(),
        subtotalMinor: 6497, // 2 * $24.99 + 1 * $19.99
        deliveryFeeMinor: 500, // $5.00
        totalMinor: 6997, // $69.97
        currency: 'USD',
        notes: '',
        source: 'demo_seed',
        status: 'OUT_FOR_DELIVERY',
        paymentStatus: 'PAID',
      },
    }),
  ])

  // Create order items
  await Promise.all([
    prisma.orderItem.createMany({
      data: [
        {
          orderId: orders[0].id,
          productId: products[0].id,
          productNameSnapshot: products[0].name,
          unitPriceMinor: products[0].priceMinor,
          quantity: 2,
          lineTotalMinor: products[0].priceMinor * 2,
        },
        {
          orderId: orders[0].id,
          productId: products[2].id,
          productNameSnapshot: products[2].name,
          unitPriceMinor: products[2].priceMinor,
          quantity: 1,
          lineTotalMinor: products[2].priceMinor,
        },
      ],
    }),
    prisma.orderItem.createMany({
      data: [
        {
          orderId: orders[1].id,
          productId: products[1].id,
          productNameSnapshot: products[1].name,
          unitPriceMinor: products[1].priceMinor,
          quantity: 1,
          lineTotalMinor: products[1].priceMinor,
        },
        {
          orderId: orders[1].id,
          productId: products[3].id,
          productNameSnapshot: products[3].name,
          unitPriceMinor: products[3].priceMinor,
          quantity: 1,
          lineTotalMinor: products[3].priceMinor,
        },
      ],
    }),
    prisma.orderItem.createMany({
      data: [
        {
          orderId: orders[2].id,
          productId: products[4].id,
          productNameSnapshot: products[4].name,
          unitPriceMinor: products[4].priceMinor,
          quantity: 2,
          lineTotalMinor: products[4].priceMinor * 2,
        },
        {
          orderId: orders[2].id,
          productId: products[0].id,
          productNameSnapshot: products[0].name,
          unitPriceMinor: products[0].priceMinor,
          quantity: 1,
          lineTotalMinor: products[0].priceMinor,
        },
      ],
    }),
  ])

  // Create order events
  await Promise.all([
    prisma.orderEvent.createMany({
      data: [
        {
          orderId: orders[0].id,
          eventType: 'order_created',
          payloadJson: JSON.stringify({ source: 'demo_seed' }),
        },
        {
          orderId: orders[0].id,
          eventType: 'status_changed',
          payloadJson: JSON.stringify({ from: 'PENDING', to: 'CONFIRMED' }),
        },
      ],
    }),
    prisma.orderEvent.createMany({
      data: [
        {
          orderId: orders[1].id,
          eventType: 'order_created',
          payloadJson: JSON.stringify({ source: 'demo_seed' }),
        },
        {
          orderId: orders[1].id,
          eventType: 'status_changed',
          payloadJson: JSON.stringify({ from: 'PENDING', to: 'CONFIRMED' }),
        },
        {
          orderId: orders[1].id,
          eventType: 'status_changed',
          payloadJson: JSON.stringify({ from: 'CONFIRMED', to: 'PACKED' }),
        },
      ],
    }),
    prisma.orderEvent.createMany({
      data: [
        {
          orderId: orders[2].id,
          eventType: 'order_created',
          payloadJson: JSON.stringify({ source: 'demo_seed' }),
        },
        {
          orderId: orders[2].id,
          eventType: 'status_changed',
          payloadJson: JSON.stringify({ from: 'PENDING', to: 'CONFIRMED' }),
        },
        {
          orderId: orders[2].id,
          eventType: 'status_changed',
          payloadJson: JSON.stringify({ from: 'CONFIRMED', to: 'PACKED' }),
        },
        {
          orderId: orders[2].id,
          eventType: 'status_changed',
          payloadJson: JSON.stringify({ from: 'PACKED', to: 'OUT_FOR_DELIVERY' }),
        },
        {
          orderId: orders[2].id,
          eventType: 'payment_completed',
          payloadJson: JSON.stringify({ provider: 'STRIPE', amount: 6997 }),
        },
      ],
    }),
  ])

  console.log('✅ Database seeding completed!')
  console.log('')
  console.log('Demo credentials:')
  console.log('Email: demo@seller.com')
  console.log('Password: demo123')
  console.log('')
  console.log('Demo seller slug: demo-store')
  console.log('')
  console.log('Created:')
  console.log(`- 1 user`)
  console.log(`- 1 seller`)
  console.log(`- ${products.length} products`)
  console.log(`- ${customers.length} customers`)
  console.log(`- ${orders.length} orders`)
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
