import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { orderService } from '@/server/services/order.service'
import { NextRequest, NextResponse } from 'next/server'

function safeParseJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return { raw: value } }
}

async function getOrderDetail({ id }: { id: string }, request: NextRequest) {
  const user = await getCurrentUser(request)
  const seller = requireSeller(user)

  const order = await orderService.getOrderById(id, seller.sellerId)

  if (!order) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } },
      { status: 404 }
    )
  }

  return NextResponse.json({
    success: true,
    data: {
      order: {
        id: order.id,
        publicOrderNumber: order.publicOrderNumber,
        status: order.status,
        paymentType: order.paymentType,
        paymentStatus: order.paymentStatus,
        subtotalMinor: order.subtotalMinor,
        deliveryFeeMinor: order.deliveryFeeMinor,
        totalMinor: order.totalMinor,
        currency: order.currency,
        source: order.source,
        notes: order.notes,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        customer: {
          id: order.customer.id,
          name: order.customer.name,
          phone: order.customer.phone,
          addressText: order.customer.addressText,
        },
        items: order.orderItems.map((item) => ({
          id: item.id,
          productId: item.productId,
          productNameSnapshot: item.productNameSnapshot,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
        // Full event timeline — sorted ascending (oldest first)
        events: (order.events ?? []).map((event) => ({
          id: event.id,
          type: event.eventType,
          actor: event.actorUserId,
          payload: safeParseJson(event.payloadJson),
          createdAt: event.createdAt,
        })),
      },
    },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    return getOrderDetail({ id }, request)
  } catch (_error) {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch order' } },
      { status: 500 }
    )
  }
}
