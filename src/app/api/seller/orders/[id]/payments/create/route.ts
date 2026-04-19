import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { ApiError, handleApiError } from '@/server/lib/errors'
import { logger } from '@/server/lib/logger'
import { PaymentService } from '@/server/services/payment.service'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const CreatePaymentAttemptSchema = z.object({
  provider: z.enum(['STRIPE', 'CASH', 'BANK_TRANSFER', 'OTHER']),
  amountMinor: z.number().int('Amount must be an integer').min(1, 'Amount must be positive'),
  currency: z.string().trim().min(3).max(3), // ISO 4217 3-letter code
  metadata: z.record(z.string(), z.unknown()).optional(),
})

async function createPaymentAttempt(
  { id }: { id: string },
  request: NextRequest
): Promise<NextResponse> {
  const user = await getCurrentUser(request)
  requireSeller(user)

  // Verify order belongs to seller (tenant isolation)
  const order = await prisma.order.findFirst({
    where: { id, sellerId: user.sellerId! },
  })
  if (!order) {
    throw new ApiError(404, 'Order not found')
  }

  const body = await request.json()
  const parsed = CreatePaymentAttemptSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid payment attempt payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 422 }
    )
  }

  const paymentAttempt = await PaymentService.createPaymentAttempt(
    {
      orderId: id,
      provider: parsed.data.provider,
      amountMinor: parsed.data.amountMinor,
      currency: parsed.data.currency,
      metadata: parsed.data.metadata,
    },
    user.id
  )

  return NextResponse.json({ success: true, data: { paymentAttempt } }, { status: 201 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params
    if (!id?.trim()) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Order ID is required' } },
        { status: 422 }
      )
    }
    return createPaymentAttempt({ id }, request)
  } catch (error) {
    logger.error('Create payment attempt failed', error as Error)
    return handleApiError(error)
  }
}
