import { prisma } from '@/server/db/prisma'
import { ApiError } from '@/server/lib/errors'
import { NextRequest, NextResponse } from 'next/server'

async function getProducts(sellerSlug: string, request: NextRequest) {
  const seller = await prisma.seller.findUnique({
    where: { slug: sellerSlug },
  })

  if (!seller) {
    throw new ApiError(404, 'Seller not found')
  }

  if (seller.status !== 'ACTIVE') {
    throw new ApiError(404, 'Seller not available')
  }

  const products = await prisma.product.findMany({
    where: {
      sellerId: seller.id,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      priceMinor: true,
      currency: true,
      stockQuantity: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return NextResponse.json({
    seller: {
      id: seller.id,
      brandName: seller.brandName,
      slug: seller.slug,
      currency: seller.currency,
    },
    products,
  })
}

export async function GET(request: NextRequest, context: { params: { sellerSlug: string } }) {
  try {
    console.log('GET /api/public/[sellerSlug]/products called')
    const { sellerSlug } = context.params
    console.log('sellerSlug:', sellerSlug)
    return await getProducts(sellerSlug, request)
  } catch (error) {
    console.error('Error in GET /api/public/[sellerSlug]/products:', error)
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
