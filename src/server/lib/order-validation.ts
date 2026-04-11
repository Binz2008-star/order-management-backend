/**
 * Order Validation Service
 * 
 * Handles runtime order validation with platform integration
 * while maintaining domain boundary separation.
 */

import { platformClient } from './platform-integration';

export interface OrderItem {
  productId: string;
  quantity: number;
}

export interface ValidatedOrderItem extends OrderItem {
  productNameSnapshot: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export class OrderValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_PRODUCT' | 'DUPLICATE_PRODUCT' | 'INVALID_QUANTITY'
  ) {
    super(message);
    this.name = 'OrderValidationError';
  }
}

/**
 * Validate order items against platform catalog
 */
export async function validateOrderItems(
  sellerId: string,
  items: OrderItem[]
): Promise<ValidatedOrderItem[]> {
  if (!items.length) {
    throw new OrderValidationError('Order must contain at least one item', 'INVALID_QUANTITY');
  }

  // Check for duplicate product IDs
  const productIds = items.map(item => item.productId);
  const uniqueProductIds = new Set(productIds);
  if (uniqueProductIds.size !== productIds.length) {
    throw new OrderValidationError('Duplicate product IDs are not allowed', 'DUPLICATE_PRODUCT');
  }

  // Validate quantities
  items.forEach((item, index) => {
    if (item.quantity <= 0) {
      throw new OrderValidationError(
        `Item ${index + 1}: Quantity must be greater than 0`,
        'INVALID_QUANTITY'
      );
    }
    if (item.quantity > 100) {
      throw new OrderValidationError(
        `Item ${index + 1}: Quantity cannot exceed 100`,
        'INVALID_QUANTITY'
      );
    }
  });

  // Validate products against platform catalog
  const productMap = await platformClient.validateProducts(productIds);
  
  const validatedItems: ValidatedOrderItem[] = [];
  
  for (const item of items) {
    const platformProduct = productMap.get(item.productId);
    
    if (!platformProduct) {
      throw new OrderValidationError(
        `Product ${item.productId} not found or not available`,
        'INVALID_PRODUCT'
      );
    }

    // Verify product belongs to this seller
    const isOwner = await platformClient.verifyProductOwnership(item.productId, sellerId);
    if (!isOwner) {
      throw new OrderValidationError(
        `Product ${item.productId} does not belong to seller ${sellerId}`,
        'INVALID_PRODUCT'
      );
    }

    // Get pricing from platform
    const unitPriceMinor = await platformClient.getProductPricing(item.productId);
    
    validatedItems.push({
      productId: item.productId,
      quantity: item.quantity,
      productNameSnapshot: platformProduct.name,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * item.quantity
    });
  }

  return validatedItems;
}

/**
 * Calculate order totals from validated items
 */
export function calculateOrderTotals(items: ValidatedOrderItem[], deliveryFeeMinor: number = 0) {
  const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const totalMinor = subtotalMinor + deliveryFeeMinor;

  return {
    subtotalMinor,
    deliveryFeeMinor,
    totalMinor
  };
}
