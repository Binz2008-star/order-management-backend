import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { withQueryValidation, withValidation, ApiError } from '@/server/lib/errors'
import { PaginationSchema, CreateProductSchema, UpdateProductSchema } from '@/server/lib/validation'

async function getProducts(query: any, request: NextRequest) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  const { page, limit } = query
  const skip = (page - 1) * limit

  const where = {
    sellerId: user.sellerId!,
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

  return NextResponse.json({
    products: products.map(product => ({
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
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  })
}

async function createProduct(productData: any, request: NextRequest) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Check if slug is unique for this seller
  const existingProduct = await prisma.product.findUnique({
    where: {
      sellerId_slug: {
        sellerId: user.sellerId!,
        slug: productData.slug,
      },
    },
  })

  if (existingProduct) {
    throw new ApiError(400, 'Product with this slug already exists')
  }

  const product = await prisma.product.create({
    data: {
      ...productData,
      sellerId: user.sellerId!,
    },
  })

  return NextResponse.json({
    product: {
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
    },
  }, { status: 201 })
}

export const GET = withQueryValidation(PaginationSchema, (data, request) =>
  getProducts(data, request)
)

export const POST = withValidation(CreateProductSchema, (data, request) =>
  createProduct(data, request)
)
