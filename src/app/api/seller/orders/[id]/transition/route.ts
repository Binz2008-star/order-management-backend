import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { handleApiError } from '@/server/lib/errors'
import { orderService } from '@/server/services/order.service'
import {
  ORDER_STATUS_VALUES,
  OrderStatus,
  OrderTransitionError,
} from '@/shared/constants/order-status'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const TransitionRequestSchema = z.object({
  toStatus: z.enum(ORDER_STATUS_VALUES),
  reason: z.string().trim().max(500).optional(),
})

/**
 * PATCH /api/seller/orders/:id/transition
 *
 * The ONLY endpoint that changes order status.
 * Routes through orderService.updateOrderStatus → applyOrderTransitionInTx.
 * No direct Prisma status writes here.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params

    const body = await request.json()
    const parsed = TransitionRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 }
      )
    }

    const { toStatus, reason } = parsed.data

    const user = await getCurrentUser(request)
    const seller = requireSeller(user)

    // Verify order belongs to this seller before transitioning
    const existing = await orderService.getOrderById(id, seller.sellerId)

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } },
        { status: 404 }
      )
    }

    // All business logic and state mutation inside orderService
    const updatedOrder = await orderService.updateOrderStatus({
      orderId: id,
      newStatus: toStatus as OrderStatus,
      actorUserId: seller.id,
      reason,
    })

    return NextResponse.json({
      success: true,
      data: {
        order: {
          id: updatedOrder.id,
          publicOrderNumber: updatedOrder.publicOrderNumber,
          status: updatedOrder.status,
          updatedAt: updatedOrder.updatedAt,
          // Include latest events so UI can update timeline without a second GET
          events: (updatedOrder.events ?? []).map((event) => ({
            id: event.id,
            type: event.eventType,
            actor: event.actorUserId,
            createdAt: event.createdAt,
          })),
        },
      },
    })
  } catch (error: unknown) {
    if (
      error instanceof OrderTransitionError ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name?: string }).name === 'OrderTransitionError')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: (error as Error).message,
          },
        },
        { status: 400 }
      )
    }

    return handleApiError(error)
  }
}
