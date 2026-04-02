import { PrismaClient } from '@prisma/client'

// Test database setup
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'file:./test.db'
    }
  }
})

beforeAll(async () => {
  // Connect to test database
  await prisma.$connect()
})

afterAll(async () => {
  // Cleanup and disconnect
  await prisma.$disconnect()
})

beforeEach(async () => {
  // Clean database before each test
  await prisma.orderEvent.deleteMany()
  await prisma.paymentAttempt.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.product.deleteMany()
  await prisma.seller.deleteMany()
  await prisma.user.deleteMany()
})

// Export prisma for tests
global.prisma = prisma
