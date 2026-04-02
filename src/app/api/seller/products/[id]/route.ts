import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { ApiError, withParamsValidation, withValidation } from '@/server/lib/errors'
import { IdSchema, UpdateProductSchema } from '@/server/lib/validation'
import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'

type UpdateProductData = z.infer<typeof UpdateProductSchema>

async function updateProduct(
  { id }: { id: string },
  productData: UpdateProductData,
  request: NextRequest
) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Check if product exists and belongs to seller
  const existingProduct = await prisma.product.findFirst({
    where: {
      id,
      sellerId: user.sellerId!,
    },
  })

  if (!existingProduct) {
    throw new ApiError(404, 'Product not found')
  }

  // If updating slug, check uniqueness
  if (productData.slug && productData.slug !== existingProduct.slug) {
    const slugConflict = await prisma.product.findUnique({
      where: {
        sellerId_slug: {
          sellerId: user.sellerId!,
          slug: productData.slug,
        },
      },
    })

    if (slugConflict) {
      throw new ApiError(400, 'Product with this slug already exists')
    }
  }

  const product = await prisma.product.update({
    where: { id },
    data: productData,
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
  })
}

async function deleteProduct({ id }: { id: string }, request: NextRequest) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Check if product exists and belongs to seller
  const existingProduct = await prisma.product.findFirst({
    where: {
      id,
      sellerId: user.sellerId!,
    },
    include: {
      _count: {
        select: {
          orderItems: true,
        },
      },
    },
  })

  if (!existingProduct) {
    throw new ApiError(404, 'Product not found')
  }

  // Check if product has orders
  if (existingProduct._count.orderItems > 0) {
    throw new ApiError(400, 'Cannot delete product with existing orders')
  }

  await prisma.product.delete({
    where: { id },
  })

  return NextResponse.json({ success: true })
}

export const PATCH = withParamsValidation(
  (params, request) =>
    withValidation(UpdateProductSchema, (data, req) =>
      updateProduct(params, data, req)
    )(request),
  IdSchema
)

export const DELETE = withParamsValidation((data, request) =>
  deleteProduct(data, request),
  IdSchema
)
