import { prisma } from '@/server/db/prisma'
import { NextRequest, NextResponse } from 'next/server'

async function getPublicProducts(
  { sellerSlug }: { sellerSlug: string },
  _request: NextRequest
): Promise<NextResponse> {
  // Find seller by slug
  const seller = await prisma.seller.findUnique({
    where: { slug: sellerSlug },
  })

  if (!seller) {
    return NextResponse.json(
      { error: 'Seller not found' },
      { status: 404 }
    )
  }

  // Get active products for this seller
  const products = await prisma.product.findMany({
    where: {
      sellerId: seller.id,
      isActive: true,
      stockQuantity: { gt: 0 },
    },
    orderBy: {
      createdAt: 'desc',
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
  })

  return NextResponse.json({
    seller: {
      id: seller.id,
      brandName: seller.brandName,
      slug: seller.slug,
      currency: seller.currency,
    },
    products: products.map(product => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      priceMinor: product.priceMinor,
      currency: product.currency,
      stockQuantity: product.stockQuantity,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    })),
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sellerSlug: string }> }
) {
  try {
    const { sellerSlug } = await params
    return getPublicProducts({ sellerSlug }, request)
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid parameters' },
      { status: 400 }
    )
  }
}
