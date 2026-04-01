import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { withParamsValidation, ApiError } from '@/server/lib/errors'
import { IdSchema } from '@/server/lib/validation'
import { OrderEventService } from '@/server/services/order-event.service'
import { prisma } from '@/server/db/prisma'

async function getOrderEvents(
  { id }: { id: string },
  request: NextRequest
) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Verify order belongs to seller
  const order = await prisma.order.findFirst({
    where: {
      id,
      sellerId: user.sellerId!,
    },
  })

  if (!order) {
    throw new ApiError(404, 'Order not found')
  }

  // Get order events
  const events = await OrderEventService.getOrderTimeline(prisma, id)

  return NextResponse.json({
    events,
    order: {
      id: order.id,
      publicOrderNumber: order.publicOrderNumber,
      status: order.status,
    },
  })
}

export const GET = withParamsValidation(getOrderEvents, IdSchema)
