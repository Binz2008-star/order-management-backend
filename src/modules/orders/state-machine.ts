/**
 * BACKWARD COMPATIBILITY SHIM — modules/orders/state-machine.ts
 *
 * All values re-exported from the single source of truth.
 * Do not add new logic here — use @/shared/constants/order-status directly.
 */
export {
  OrderStatus,
  OrderTransitionError,
  ORDER_STATUS_TRANSITIONS,
  isValidOrderTransition,
  isTerminalOrderStatus,
  getValidNextStates,
} from '@/shared/constants/order-status'

// Legacy class-based API for backward compatibility
import { OrderStatus, ORDER_STATUS_TRANSITIONS, OrderTransitionError } from '@/shared/constants/order-status'

export class OrderStateMachine {
  static canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false
  }

  static validateTransition(from: OrderStatus, to: OrderStatus): void {
    if (!this.canTransition(from, to)) {
      throw new OrderTransitionError(from, to)
    }
  }

  static isTerminal(status: OrderStatus): boolean {
    return ORDER_STATUS_TRANSITIONS[status].length === 0
  }

  static getAllValidTransitions(): Record<OrderStatus, OrderStatus[]> {
    return { ...ORDER_STATUS_TRANSITIONS }
  }

  static getValidNextStates(currentStatus: OrderStatus): OrderStatus[] {
    return ORDER_STATUS_TRANSITIONS[currentStatus] || []
  }
}
