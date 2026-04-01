import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db/prisma'
import { logger } from '@/server/lib/logger'
import { PaymentProvider, PaymentStatus, WebhookStatus } from '@prisma/client'

// Stripe webhook signature verification (simplified)
async function verifyStripeSignature(payload: string, signature: string): Promise<boolean> {
  // In production, you would use Stripe's webhook signing secret
  // For demo purposes, we'll just return true
  return true
}

async function processStripeWebhook(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature') || ''

  try {
    // Verify webhook signature
    const isValid = await verifyStripeSignature(body, signature)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      )
    }

    const event = JSON.parse(body)
    
    // Check for duplicate webhook
    const existingWebhook = await prisma.webhookEvent.findUnique({
      where: {
        provider_eventId: {
          provider: PaymentProvider.STRIPE,
          eventId: event.id,
        },
      },
    })

    if (existingWebhook) {
      return NextResponse.json({ status: 'duplicate' })
    }

    // Store webhook event
    await prisma.$transaction(async (tx) => {
      // Create webhook event record
      await tx.webhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          eventId: event.id,
          eventType: event.type,
          payloadJson: event,
          status: WebhookStatus.PROCESSED,
          processedAt: new Date(),
        },
      })

      // Handle payment success
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object
        
        // Find payment attempt
        const paymentAttempt = await tx.paymentAttempt.findFirst({
          where: {
            provider: PaymentProvider.STRIPE,
            providerReference: paymentIntent.id,
          },
        })

        if (paymentAttempt) {
          // Update payment attempt
          await tx.paymentAttempt.update({
            where: { id: paymentAttempt.id },
            data: {
              status: PaymentStatus.PAID,
              rawPayloadJson: event,
            },
          })

          // Update order payment status
          await tx.order.update({
            where: { id: paymentAttempt.orderId },
            data: { paymentStatus: PaymentStatus.PAID },
          })

          // Create order event
          await tx.orderEvent.create({
            data: {
              orderId: paymentAttempt.orderId,
              eventType: 'payment_completed',
              payloadJson: {
                provider: PaymentProvider.STRIPE,
                providerReference: paymentIntent.id,
                amountMinor: paymentIntent.amount,
              },
            },
          })

          logger.info('Payment processed successfully', {
            provider: PaymentProvider.STRIPE,
            paymentIntentId: paymentIntent.id,
            orderId: paymentAttempt.orderId,
            amount: paymentIntent.amount,
          })
        }
      }
    })

    return NextResponse.json({ status: 'processed' })
  } catch (error) {
    logger.error('Webhook processing failed', error as Error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

export const POST = processStripeWebhook
