import { prisma } from '@/server/db/prisma'
import { ApiError } from '@/server/http/api-error'
import { createRouteHandler } from '@/server/http/route'
import { type SellerAuthUser } from '@/server/lib/auth'
import { RATE_LIMIT_CONFIGS } from '@/server/lib/rate-limit'
import {
  CreateProductSchema,
  PaginationSchema,
  type CreateProductInput,
  type PaginationInput,
} from '@/server/lib/validation'

function serializeProduct(product: {
  id: string
  name: string
  slug: string
  description: string | null
  priceMinor: number
  currency: string
  stockQuantity: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    priceMinor: product.priceMinor,
    currency: product.currency,
    stockQuantity: product.stockQuantity,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

async function getProducts({
  query,
  user,
}: {
  query: PaginationInput
  user: { sellerId: string }
}) {
  const { page, limit } = query
  const skip = (page - 1) * limit

  const where = {
    sellerId: user.sellerId,
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ])

  const totalPages = Math.ceil(total / limit)

  return {
    body: {
      products: products.map(serializeProduct),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    },
  }
}

async function createProduct({
  body,
  user,
}: {
  body: CreateProductInput
  user: { sellerId: string }
}) {
  // Check if slug is unique for this seller
  const existingProduct = await prisma.product.findUnique({
    where: {
      sellerId_slug: {
        sellerId: user.sellerId,
        slug: body.slug,
      },
    },
  })

  if (existingProduct) {
    throw new ApiError(409, 'Product with this slug already exists', 'PRODUCT_SLUG_CONFLICT')
  }

  const product = await prisma.product.create({
    data: {
      ...body,
      sellerId: user.sellerId,
    },
  })

  return {
    status: 201,
    body: {
      product: serializeProduct(product),
    },
  }
}

export const GET = createRouteHandler<undefined, PaginationInput, undefined, SellerAuthUser>({
  auth: 'seller',
  querySchema: PaginationSchema,
  rateLimit: RATE_LIMIT_CONFIGS.SELLER_API,
  handler: getProducts,
})

export const POST = createRouteHandler<CreateProductInput, undefined, undefined, SellerAuthUser>({
  auth: 'seller',
  bodySchema: CreateProductSchema,
  rateLimit: RATE_LIMIT_CONFIGS.SELLER_API,
  handler: createProduct,
})
