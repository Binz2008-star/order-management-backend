import { PrismaClient } from '@prisma/client'
import { vi } from 'vitest'

// Mock NextRequest for API tests
vi.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    constructor(url: string, init?: RequestInit) {
      this.url = url
      this.method = init?.method || 'GET'
      this.headers = new Headers(init?.headers)
      this.body = init?.body
    }
    url: string
    method: string
    headers: Headers
    body: unknown
    ip = '127.0.0.1'
    json = async () => {
      if (typeof this.body === 'string') {
        return JSON.parse(this.body)
      }

      if (this.body instanceof ArrayBuffer) {
        return JSON.parse(Buffer.from(this.body).toString('utf8'))
      }

      return this.body
    }
    text = async () => {
      if (typeof this.body === 'string') {
        return this.body
      }

      if (this.body instanceof ArrayBuffer) {
        return Buffer.from(this.body).toString('utf8')
      }

      return this.body === undefined || this.body === null
        ? ''
        : String(this.body)
    }
  },
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => ({
      ...init,
      json: () => Promise.resolve(data),
      status: init?.status || 200,
    }),
  },
}))

// Setup test environment variables
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/order_management_test?schema=public'

const databaseUrl = process.env.DATABASE_URL

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
})

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  // Clean up only order-related data, keep seed data
  await prisma.orderEvent.deleteMany()
  await prisma.paymentAttempt.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.customer.deleteMany()

  // Add a small delay to ensure cleanup is complete
  await new Promise(resolve => setTimeout(resolve, 10))
})

  ; (global as typeof global & { prisma: typeof prisma }).prisma = prisma

export { prisma }
