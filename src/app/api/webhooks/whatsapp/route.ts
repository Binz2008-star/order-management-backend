import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db/prisma'
import { logger } from '@/server/lib/logger'
import { WebhookStatus } from '@prisma/client'

// WhatsApp webhook processing (simplified)
async function processWhatsAppWebhook(request: NextRequest) {
  const body = await request.json()
  
  try {
    // Store webhook event
    await prisma.webhookEvent.create({
      data: {
        provider: 'WHATSAPP' as any, // Add to enum if needed
        eventId: body.id || 'unknown',
        eventType: body.type || 'message',
        payloadJson: body,
        status: WebhookStatus.PROCESSED,
        processedAt: new Date(),
      },
    })

    logger.info('WhatsApp webhook processed', {
      eventId: body.id,
      eventType: body.type,
    })

    return NextResponse.json({ status: 'processed' })
  } catch (error) {
    logger.error('WhatsApp webhook processing failed', error as Error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

export const POST = processWhatsAppWebhook
