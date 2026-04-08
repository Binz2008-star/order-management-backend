import { prisma } from '@/server/db/prisma'
import { NextRequest, NextResponse } from 'next/server'

// Pure GET endpoint - no mutations, only reads product catalog data
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
  // TODO: This should query the platform database, not runtime
  // For now, return empty array since Product model moved to platform
  const products: Array<{
    id: string;
    name: string;
    slug: string;
    description: string;
    priceMinor: number;
    currency: string;
    stockQuantity: number;
    createdAt: Date;
    updatedAt: Date;
  }> = []

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
