import { prisma } from '../../db/prisma'
import { PaymentService as CanonicalPaymentService } from '../../services/payment.service'

class PaymentServiceCompatibilityWrapper {
  async simulatePayment(orderId: string, success = true, _actorUserId?: string) {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        totalMinor: true,
        currency: true,
      },
    })

    const attempt = await CanonicalPaymentService.createPaymentAttempt({
      orderId: order.id,
      provider: 'SIMULATOR',
      amountMinor: order.totalMinor,
      currency: order.currency,
    })

    if (success) {
      return CanonicalPaymentService.updatePaymentStatus({
        paymentAttemptId: attempt.id,
        status: 'COMPLETED',
        providerReference: `SIM-${Date.now()}`,
      })
    }

    return CanonicalPaymentService.updatePaymentStatus({
      paymentAttemptId: attempt.id,
      status: 'FAILED',
      failureReason: 'Simulated payment failure',
    })
  }
}

export const paymentService = new PaymentServiceCompatibilityWrapper()
