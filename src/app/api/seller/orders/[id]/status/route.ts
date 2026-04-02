import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { ApiError, handleApiError } from '@/server/lib/errors'
import { IdSchema, UpdateOrderStatusSchema } from '@/server/lib/validation'
import { OrderTransitionError } from '@/server/modules/orders/transitions'
import { orderService } from '@/server/services/order.service'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  context: { params: unknown }
): Promise<NextResponse> {
  try {
    const { id } = IdSchema.parse(context.params)
    const { status, reason } = UpdateOrderStatusSchema.parse(await request.json())

    const user = await getCurrentUser(request)
    const seller = requireSeller(user)

    const existingOrder = await prisma.order.findFirst({
      where: {
        id,
        sellerId: seller.sellerId,
      },
      select: {
        id: true,
      },
    })

    if (!existingOrder) {
      throw new ApiError(404, 'Order not found')
    }

    const updatedOrder = await orderService.updateOrderStatus({
      orderId: id,
      newStatus: status,
      actorUserId: seller.id,
      reason,
    })

    return NextResponse.json({
      order: {
        id: updatedOrder.id,
        publicOrderNumber: updatedOrder.publicOrderNumber,
        status: updatedOrder.status,
        updatedAt: updatedOrder.updatedAt,
      },
    })
  } catch (error: unknown) {
    if (error instanceof OrderTransitionError) {
      return NextResponse.json(
        { error: (error as OrderTransitionError).message },
        { status: 400 }
      )
    }

    return handleApiError(error)
  }
}
