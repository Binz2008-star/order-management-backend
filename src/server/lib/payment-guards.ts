export interface PaymentInvariant {
  orderId: string
  paymentType: string
  currentPaymentStatus: string
}

export interface PaymentAttempt {
  id: string
  status: string
  orderId: string
  provider: string
  amountMinor: number
  currency: string
}

export class PaymentGuards {
  static rejectCODPaymentAttempts(order: PaymentInvariant): void {
    if (order.paymentType === 'CASH_ON_DELIVERY') {
      throw new Error('Payment attempts not allowed for Cash on Delivery orders')
    }
  }

  static preventDuplicatePaymentAttempts(
    existingAttempts: PaymentAttempt[],
    orderId: string
  ): void {
    const activeAttempts = existingAttempts.filter(
      attempt => ['PENDING', 'PROCESSING'].includes(attempt.status)
    )

    if (activeAttempts.length > 0) {
      throw new Error(`Payment attempt already in progress for order ${orderId}`)
    }
  }

  static validateRefundAmount(
    refundAmount: number,
    originalAmount: number,
    alreadyRefunded: number = 0
  ): void {
    const totalRefund = alreadyRefunded + refundAmount
    if (totalRefund > originalAmount) {
      throw new Error(`Refund amount $${totalRefund / 100} exceeds original payment $${originalAmount / 100}`)
    }
  }

  static enforcePaymentStateTransition(
    fromStatus: string,
    toStatus: string
  ): void {
    const validTransitions: Record<string, string[]> = {
      'PENDING': ['PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED'],
      'PROCESSING': ['COMPLETED', 'FAILED', 'CANCELLED'],
      'COMPLETED': ['REFUNDED'],
      'FAILED': ['PENDING'], // Allow retry
      'CANCELLED': ['PENDING'], // Allow retry
      'REFUNDED': [] // Terminal
    }

    if (!validTransitions[fromStatus]?.includes(toStatus)) {
      throw new Error(`Invalid payment transition: ${fromStatus} → ${toStatus}`)
    }
  }

  static preventRefundOnNonCompletedPayment(status: string): void {
    if (status !== 'COMPLETED') {
      throw new Error('Only completed payments can be refunded')
    }
  }

  static preventTerminalStateModification(status: string): void {
    const terminalStates = ['REFUNDED', 'CANCELLED']
    if (terminalStates.includes(status)) {
      throw new Error(`Cannot modify payment in terminal state: ${status}`)
    }
  }
}
