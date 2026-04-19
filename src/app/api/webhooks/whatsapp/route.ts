import { logger } from '@/server/lib/logger'
import { WebhookService } from '@/server/services/webhook.service'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * POST /api/webhooks/whatsapp
 *
 * Receives WhatsApp webhook events.
 * Validates the payload shape before delegating to WebhookService.
 * No direct Prisma writes in this handler.
 */
const WhatsAppWebhookSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
}).passthrough() // allow additional fields from WhatsApp payload

async function processWhatsAppWebhook(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } },
      { status: 400 }
    )
  }

  const parsed = WhatsAppWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid webhook payload',
          details: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 422 }
    )
  }

  await WebhookService.processWhatsApp(parsed.data)
  return NextResponse.json({ success: true, data: { status: 'processed' } })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return processWhatsAppWebhook(request)
  } catch (error) {
    logger.error('WhatsApp webhook handler failed', error as Error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Webhook processing failed' } },
      { status: 500 }
    )
  }
}
