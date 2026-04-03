import { prisma } from '../../db/prisma'
import { orderService } from '../../services/order.service'
import { PaymentService as CanonicalPaymentService } from '../../services/payment.service'

class PaymentServiceCompatibilityWrapper {
  async simulatePayment(orderId: string, success = true, actorUserId?: string) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        totalMinor: true,
        currency: true,
        paymentType: true,
      },
    })

    // Update payment type through proper service layer
    if (order.paymentType === 'CASH_ON_DELIVERY') {
      await orderService.updateOrderPaymentType(orderId, 'CARD', actorUserId)
    }

    const attempt = await CanonicalPaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'SIMULATOR',
      amountMinor: order.totalMinor,
      currency: order.currency,
    }, actorUserId)

    const processingAttempt = await CanonicalPaymentService.updatePaymentStatus({
      paymentAttemptId: attempt.id,
      status: 'PROCESSING',
    }, actorUserId)

    if (success) {
      return CanonicalPaymentService.updatePaymentStatus({
        paymentAttemptId: processingAttempt.id,
        status: 'COMPLETED',
        providerReference: `SIM-${Date.now()}`,
      }, actorUserId)
    }

    return CanonicalPaymentService.updatePaymentStatus({
      paymentAttemptId: processingAttempt.id,
      status: 'FAILED',
      failureReason: 'Simulated payment failure',
    }, actorUserId)
  }
}

export const paymentService = new PaymentServiceCompatibilityWrapper()
