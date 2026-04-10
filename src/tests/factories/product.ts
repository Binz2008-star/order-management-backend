// Note: There is no Product table in the schema.
// Products are referenced by ID only in order items.
// The v1-order.authority.ts uses MOCK_EXTERNAL_ID_MAP to translate external IDs.

let productCounter = 0

/**
 * Generate a unique external product ID for testing.
 * These IDs must be registered in MOCK_EXTERNAL_ID_MAP in v1-order.authority.ts
 * or the order creation will fail.
 */
export function generateProductExternalId(): string {
  productCounter++
  return `product_${Date.now()}_${productCounter}`
}

/**
 * Returns a valid external product ID that exists in MOCK_EXTERNAL_ID_MAP.
 * For now, returns the hardcoded test ID.
 */
export function getValidTestProductId(): string {
  return 'product_789'
}
