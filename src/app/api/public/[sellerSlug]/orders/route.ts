import { prisma } from '@/server/db/prisma'
import { handleApiError } from '@/server/lib/errors'
import { logger } from '@/server/lib/logger'
import { SellerSlugSchema } from '@/server/lib/validation'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/public/:sellerSlug/orders
 *
 * Public read-only endpoint — no auth required, no mutations.
 * Returns the last 20 orders for a seller (public-facing order tracking).
 */
async function getPublicOrders(
  { sellerSlug }: { sellerSlug: string },
  _request: NextRequest
): Promise<NextResponse> {
  const seller = await prisma.seller.findUnique({
    where: { slug: sellerSlug },
    select: { id: true, brandName: true, slug: true },
  })

  if (!seller) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Seller not found' } },
      { status: 404 }
    )
  }

  const orders = await prisma.order.findMany({
    where: { sellerId: seller.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      publicOrderNumber: true,
      status: true,
      paymentStatus: true,
      totalMinor: true,
      currency: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ success: true, data: { seller, orders } })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sellerSlug: string }> }
): Promise<NextResponse> {
  try {
    const raw = await params
    const parsed = SellerSlugSchema.safeParse(raw)

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid seller slug',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 }
      )
    }

    return getPublicOrders(parsed.data, request)
  } catch (error) {
    logger.error('Get public orders failed', error as Error)
    return handleApiError(error)
  }
}
