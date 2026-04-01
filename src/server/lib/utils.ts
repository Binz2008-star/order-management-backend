import { nanoid } from 'nanoid'

export function generatePublicOrderNumber(): string {
  return `ORD-${nanoid(8).toUpperCase()}`
}

export function formatCurrency(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100)
}

export function calculateOrderTotal(items: Array<{ unitPriceMinor: number; quantity: number }>, deliveryFeeMinor: number = 0) {
  const subtotalMinor = items.reduce((sum, item) => sum + (item.unitPriceMinor * item.quantity), 0)
  const totalMinor = subtotalMinor + deliveryFeeMinor
  
  return {
    subtotalMinor,
    deliveryFeeMinor,
    totalMinor,
  }
}
