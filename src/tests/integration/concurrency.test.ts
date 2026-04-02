import { prisma } from '../../server/db/prisma'
import { hashPassword } from '../../server/lib/auth'
import { orderService } from '../../server/services/order.service'

describe('Concurrency Safety', () => {
  async function setupProduct(stock: number = 1) {
    const ts = Date.now()
    
    const user = await prisma.user.create({
      data: {
        id: `seller-${ts}`,
        email: `seller-${ts}@test.com`,
        fullName: 'Test Seller',
        passwordHash: await hashPassword('password'),
        role: 'SELLER',
        isActive: true,
      },
    })

    const seller = await prisma.seller.create({
      data: {
        id: `seller-${ts}`,
        ownerUserId: user.id,
        brandName: `brand-${ts}`,
        slug: `brand-${ts}`,
        currency: 'USD',
        status: 'ACTIVE',
      },
    })

    const product = await prisma.product.create({
      data: {
        id: `product-${ts}`,
        sellerId: seller.id,
        name: 'Test Widget',
        slug: `test-widget-${ts}`,
        priceMinor: 1000,
        currency: 'USD',
        stockQuantity: stock,
        isActive: true,
      },
    })

    const customer = await prisma.customer.create({
      data: {
        id: `customer-${ts}`,
        sellerId: seller.id,
        name: 'Test Customer',
        phone: `+1234567890${ts}`,
      },
    })

    return { product, customer, seller }
  }

  test('prevents overselling under concurrency', async () => {
    const { product, customer, seller } = await setupProduct(1) // Only 1 in stock

    const createOrder = () => orderService.createOrder({
      sellerId: seller.id,
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1 }],
      currency: 'USD',
      paymentType: 'STRIPE',
    })

    // Try to create 2 orders concurrently
    const results = await Promise.allSettled([
      createOrder(),
      createOrder()
    ])

    // Count successful orders
    const successfulOrders = results.filter(r => r.status === 'fulfilled')
    const failedOrders = results.filter(r => r.status === 'rejected')

    // Only 1 should succeed
    expect(successfulOrders).toHaveLength(1)
    expect(failedOrders).toHaveLength(1)

    // Verify stock never went negative
    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } })
    expect(finalProduct?.stockQuantity).toBe(0) // Should be exactly 0, not negative

    // Verify only 1 order was created
    const orders = await prisma.order.findMany({ 
      where: { 
        sellerId: seller.id,
        customerId: customer.id 
      }
    })
    expect(orders).toHaveLength(1)
  })

  test('system invariants hold under concurrent operations', async () => {
    const { product, customer, seller } = await setupProduct(5) // 5 in stock

    const createOrder = () => orderService.createOrder({
      sellerId: seller.id,
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 2 }],
      currency: 'USD',
      paymentType: 'STRIPE',
    })

    // Try to create 3 orders (2 items each = 6 total requested)
    const results = await Promise.allSettled([
      createOrder(),
      createOrder(),
      createOrder()
    ])

    // Only 2 should succeed (5 stock / 2 per order = 2 max orders)
    const successfulOrders = results.filter(r => r.status === 'fulfilled')
    expect(successfulOrders).toHaveLength(2)

    // Verify invariant: initial stock - sold items = remaining stock
    const finalProduct = await prisma.product.findUnique({ where: { id: product.id } })
    const soldItems = successfulOrders.length * 2 // 2 orders * 2 items each
    expect(finalProduct?.stockQuantity).toBe(5 - soldItems) // 5 - 4 = 1 remaining

    // Verify total stock + sold items = original stock
    expect(finalProduct?.stockQuantity + soldItems).toBe(5)
  })
})
