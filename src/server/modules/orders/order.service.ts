import { orderService as canonicalOrderService } from '../../services/order.service'

export type { CreateOrderData as CreateOrderRequest } from '../../services/order.service'

export interface OrderTransitionRequest {
  orderId: string
  newStatus: string
  actorUserId?: string
  notes?: string
}

class OrderServiceCompatibilityWrapper {
  async createOrder(request: {
    sellerId: string
    customerId: string
    items: Array<{ productId: string; quantity: number }>
    deliveryFeeMinor?: number
    notes?: string
  }, actorUserId?: string) {
    return canonicalOrderService.createOrder({
      sellerId: request.sellerId,
      customerId: request.customerId,
      items: request.items,
      currency: 'USD',
      paymentType: 'CARD',
      notes: request.notes,
    }, actorUserId ?? null)
  }

  async applyTransition(request: OrderTransitionRequest) {
    return canonicalOrderService.updateOrderStatus({
      orderId: request.orderId,
      newStatus: request.newStatus as never,
      actorUserId: request.actorUserId ?? 'system',
      reason: request.notes,
    })
  }

  async cancelOrder(orderId: string, actorUserId?: string, reason?: string) {
    return this.applyTransition({
      orderId,
      newStatus: 'CANCELLED',
      actorUserId,
      notes: reason,
    })
  }

  async getOrderById(orderId: string, sellerId?: string) {
    if (!sellerId) {
      throw new Error('sellerId is required for getOrderById compatibility wrapper')
    }

    return canonicalOrderService.getOrderById(orderId, sellerId)
  }

  async getOrdersBySeller(sellerId: string, options?: {
    status?: string
    limit?: number
    offset?: number
  }) {
    return canonicalOrderService.getOrders(sellerId, {
      status: options?.status as never,
      limit: options?.limit,
      page: options?.offset ? Math.floor(options.offset / (options.limit || 50)) + 1 : 1,
    }).then(result => result.orders)
  }
}

export const orderService = new OrderServiceCompatibilityWrapper()
