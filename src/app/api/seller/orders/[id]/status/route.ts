import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { withParamsValidation, withValidation, ApiError } from '@/server/lib/errors'
import { IdSchema, UpdateOrderStatusSchema } from '@/server/lib/validation'
import { isValidOrderTransition, OrderTransitionError } from '@/server/modules/orders/transitions'
import { OrderStatus } from '@prisma/client'

async function updateOrderStatus(
  { id }: { id: string },
  { status }: { status: OrderStatus },
  request: NextRequest
) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Get current order
  const currentOrder = await prisma.order.findFirst({
    where: {
      id,
      sellerId: user.sellerId!,
    },
  })

  if (!currentOrder) {
    throw new ApiError(404, 'Order not found')
  }

  // Validate transition
  if (!isValidOrderTransition(currentOrder.status, status)) {
    throw new ApiError(400, `Cannot transition from ${currentOrder.status} to ${status}`)
  }

  // Update order status and create event
  const updatedOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id },
      data: { status },
    })

    await tx.orderEvent.create({
      data: {
        orderId: id,
        actorUserId: user.id,
        eventType: 'status_changed',
        payloadJson: {
          from: currentOrder.status,
          to: status,
          actor: user.email,
        },
      },
    })

    return order
  })

  return NextResponse.json({
    order: {
      id: updatedOrder.id,
      publicOrderNumber: updatedOrder.publicOrderNumber,
      status: updatedOrder.status,
      updatedAt: updatedOrder.updatedAt,
    },
  })
}

export const PATCH = withParamsValidation(
  IdSchema,
  (params, request) =>
    withValidation(UpdateOrderStatusSchema, (data, req) =>
      updateOrderStatus(params, data, req)
    )(request)
)
