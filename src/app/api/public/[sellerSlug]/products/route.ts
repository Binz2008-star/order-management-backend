import { NextRequest, NextResponse } from 'next/server'

async function getPublicProducts(
  { sellerSlug: _sellerSlug }: { sellerSlug: string },
  _request: NextRequest
): Promise<NextResponse> {
  // TODO: Implement public products endpoint
  throw new Error('Not implemented yet')
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
