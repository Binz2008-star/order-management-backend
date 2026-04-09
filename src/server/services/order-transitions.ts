/**
 * BACKWARD COMPATIBILITY SHIM
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

export type { OrderStatusValue as OrderStatusType } from '@/shared/constants/order-status'
