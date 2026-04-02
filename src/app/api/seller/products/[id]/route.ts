import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { ApiError } from '@/server/lib/errors'
import { NextRequest, NextResponse } from 'next/server'

async function updateProduct(
  { id }: { id: string },
  productData: Record<string, unknown>,
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
          slug: productData.slug as string,
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    return updateProduct({ id }, body, request)
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid parameters' },
      { status: 400 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    return deleteProduct({ id }, request)
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid parameters' },
      { status: 400 }
    )
  }
}
