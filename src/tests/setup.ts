import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

vi.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    url: string
    method: string
    headers: Headers
    body: unknown
    ip = '127.0.0.1'

    constructor(url: string, init?: RequestInit) {
      this.url = url
      this.method = init?.method ?? 'GET'
      this.headers = new Headers(init?.headers)
      this.body = init?.body
    }

    async json() {
      if (typeof this.body === 'string') return JSON.parse(this.body)
      if (this.body instanceof ArrayBuffer) {
        return JSON.parse(Buffer.from(this.body).toString('utf8'))
      }
      return this.body
    }

    async text() {
      if (typeof this.body === 'string') return this.body
      if (this.body instanceof ArrayBuffer) {
        return Buffer.from(this.body).toString('utf8')
      }
      return this.body == null ? '' : String(this.body)
    }
  },

  NextResponse: {
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: {
          'content-type': 'application/json',
          ...(init?.headers ?? {}),
        },
      }),
  },
}))

process.env.JWT_SECRET = 'test-jwt-secret'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for tests')
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
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
  await prisma.orderEvent.deleteMany()
  await prisma.paymentAttempt.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.customer.deleteMany()
})

declare global {
  var prisma: PrismaClient | undefined
}

globalThis.prisma = prisma
