import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Inline V1 mapper for now (path resolution issue)
function toV1OrderResponse(order: any) {
  return {
    order: {
      id: order.id,
      sellerId: order.sellerId,
      publicOrderNumber: order.publicOrderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentType: order.paymentType,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      totalMinor: order.totalMinor,
      currency: order.currency || 'USD',
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        phone: order.customer.phone,
        addressText: order.customer.addressText,
      },
      items: order.orderItems.map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productNameSnapshot: item.productNameSnapshot,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
      })),
    }
  }
}

// GET /api/v1/orders/[id] - Get single order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser(request)
    requireSeller(user)

    const { id } = await params

    // Validate order ID format
    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      )
    }

    const order = await prisma.order.findFirst({
      where: {
        id,
        sellerId: user.sellerId!,
      },
      include: {
        customer: true,
        orderItems: {
          select: {
            id: true,
            productId: true,
            productNameSnapshot: true,
            unitPriceMinor: true,
            quantity: true,
            lineTotalMinor: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      )
    }

    return NextResponse.json(toV1OrderResponse(order))
  } catch (error: unknown) {
    console.error('V1 Orders GET by ID error', error instanceof Error ? error : undefined)

    return NextResponse.json(
      { error: 'Failed to fetch order' },
      { status: 500 }
    )
  }
}
