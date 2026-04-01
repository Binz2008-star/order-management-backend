import { prisma } from '@/server/db/prisma'
import { logger } from '@/server/lib/logger'
import { NotificationChannel, NotificationJobStatus } from '@prisma/client'

export interface NotificationPayload {
  channel: NotificationChannel
  recipient: string
  templateKey: string
  data: Record<string, any>
}

export class NotificationService {
  async enqueueNotification(payload: NotificationPayload): Promise<void> {
    try {
      await prisma.notificationJob.create({
        data: {
          channel: payload.channel,
          templateKey: payload.templateKey,
          status: NotificationJobStatus.PENDING,
          scheduledAt: new Date(),
        },
      })

      logger.info('Notification enqueued', {
        channel: payload.channel,
        templateKey: payload.templateKey,
        recipient: payload.recipient,
      })
    } catch (error) {
      logger.error('Failed to enqueue notification', error as Error)
      throw error
    }
  }

  async processPendingNotifications(): Promise<void> {
    const notifications = await prisma.notificationJob.findMany({
      where: {
        status: NotificationJobStatus.PENDING,
        scheduledAt: {
          lte: new Date(),
        },
      },
      include: {
        seller: true,
        order: true,
      },
      take: 10, // Process in batches
    })

    for (const notification of notifications) {
      try {
        await this.sendNotification(notification)
        
        await prisma.notificationJob.update({
          where: { id: notification.id },
          data: {
            status: NotificationJobStatus.SENT,
            sentAt: new Date(),
          },
        })

        logger.info('Notification sent successfully', {
          notificationId: notification.id,
          channel: notification.channel,
        })
      } catch (error) {
        await prisma.notificationJob.update({
          where: { id: notification.id },
          data: {
            status: NotificationJobStatus.FAILED,
            retryCount: notification.retryCount + 1,
            errorText: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        logger.error('Failed to send notification', error as Error, {
          notificationId: notification.id,
          channel: notification.channel,
        })
      }
    }
  }

  private async sendNotification(notification: any): Promise<void> {
    // Stub implementation - in production, you'd integrate with actual providers
    switch (notification.channel) {
      case NotificationChannel.WHATSAPP:
        await this.sendWhatsAppNotification(notification)
        break
      case NotificationChannel.EMAIL:
        await this.sendEmailNotification(notification)
        break
      case NotificationChannel.SMS:
        await this.sendSMSNotification(notification)
        break
      default:
        throw new Error(`Unsupported notification channel: ${notification.channel}`)
    }
  }

  private async sendWhatsAppNotification(notification: any): Promise<void> {
    // WhatsApp integration stub
    logger.info('WhatsApp notification stub', {
      recipient: notification.seller.whatsappNumber,
      templateKey: notification.templateKey,
      orderId: notification.orderId,
    })
  }

  private async sendEmailNotification(notification: any): Promise<void> {
    // Email integration stub
    logger.info('Email notification stub', {
      recipient: notification.seller.ownerUserId,
      templateKey: notification.templateKey,
    })
  }

  private async sendSMSNotification(notification: any): Promise<void> {
    // SMS integration stub
    logger.info('SMS notification stub', {
      recipient: notification.seller.whatsappNumber,
      templateKey: notification.templateKey,
    })
  }
}

export const notificationService = new NotificationService()
