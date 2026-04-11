import { NextRequest, NextResponse } from 'next/server'

/**
 * Runtime Query API - Seller Information Only
 *
 * This endpoint provides seller metadata for public storefront queries.
 * Product catalog data must come from the platform domain.
 */
async function getPublicSellerInfo(
  { sellerSlug }: { sellerSlug: string },
  _request: NextRequest
): Promise<NextResponse> {
  // TODO: Implement seller lookup from runtime database
  // For now, return error to indicate platform dependency

  return NextResponse.json({
    error: 'Product catalog queries must go to platform domain',
    message: 'This endpoint violates runtime boundary - use platform API for product data',
    platformApiUrl: `${process.env.PLATFORM_API_URL || 'http://localhost:3001'}/api/public/${sellerSlug}/products`
  }, { status: 422 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sellerSlug: string }> }
) {
  try {
    const { sellerSlug } = await params
    return getPublicSellerInfo({ sellerSlug }, request)
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid parameters' },
      { status: 400 }
    )
  }
}
