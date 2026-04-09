import { NextRequest, NextResponse } from 'next/server'

/**
 * DEPRECATED — use PATCH /api/seller/orders/:id/transition instead.
 *
 * This endpoint is kept to avoid hard 404s for any existing callers,
 * but it returns a 410 Gone with a redirect hint.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'ENDPOINT_DEPRECATED',
        message:
          'This endpoint is deprecated. Use PATCH /api/seller/orders/:id/transition instead.',
        newEndpoint: `/api/seller/orders/${id}/transition`,
      },
    },
    {
      status: 410,
      headers: {
        'Deprecation': 'true',
        'Link': `</api/seller/orders/${id}/transition>; rel="successor-version"`,
      },
    }
  )
}
