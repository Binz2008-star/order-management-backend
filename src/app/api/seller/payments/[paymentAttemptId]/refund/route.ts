import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { withParamsValidation, ApiError } from '@/server/lib/errors'
import { IdSchema } from '@/server/lib/validation'
import { PaymentService } from '@/server/services/payment.service'
import { prisma } from '@/server/db/prisma'

async function refundPayment(
  { paymentAttemptId }: { paymentAttemptId: string },
  request: NextRequest
) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Verify payment attempt belongs to seller's order
  const paymentAttempt = await prisma.paymentAttempt.findUnique({
    where: { id: paymentAttemptId },
    include: { order: true }
  })

  if (!paymentAttempt || paymentAttempt.order.sellerId !== user.sellerId!) {
    throw new ApiError(404, 'Payment attempt not found')
  }

  const body = await request.json()
  const refundedPayment = await PaymentService.refundPayment({
    paymentAttemptId,
    refundAmountMinor: body.refundAmountMinor,
    reason: body.reason,
    metadata: body.metadata,
  }, user.id)

  return NextResponse.json({
    paymentAttempt: refundedPayment,
    message: 'Payment refunded successfully',
  })
}

export const POST = withParamsValidation(refundPayment, IdSchema)
