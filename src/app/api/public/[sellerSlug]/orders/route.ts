import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/server/db/prisma'
import { withValidation, withParamsValidation, ApiError, handleApiError } from '@/server/lib/errors'
import { CreateOrderSchema, SellerSlugSchema } from '@/server/lib/validation'
import { generatePublicOrderNumber, calculateOrderTotal } from '@/server/lib/utils'
import { logger, generateRequestId } from '@/server/lib/logger'
import { createRateLimit } from '@/server/lib/rate-limit'

const rateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10, // 10 orders per 15 minutes per IP
})

async function createOrder(
  { sellerSlug }: { sellerSlug: string },
  orderData: any,
  request: NextRequest
) {
  const requestId = generateRequestId()
  logger.setRequestId(requestId)

  // Rate limiting
  const rateLimitResult = await rateLimit(request)
  if (!rateLimitResult.success) {
    throw new ApiError(429, 'Too many requests')
  }

  // Find seller
  const seller = await prisma.seller.findUnique({
    where: { slug: sellerSlug },
  })

  if (!seller) {
    throw new ApiError(404, 'Seller not found')
  }

  if (seller.status !== 'ACTIVE') {
    throw new ApiError(404, 'Seller not available')
  }

  // Validate products and calculate totals
  const productIds = orderData.items.map((item: any) => item.productId)
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      sellerId: seller.id,
      isActive: true,
    },
  })

  if (products.length !== productIds.length) {
    throw new ApiError(400, 'Some products are not available')
  }

  // Check stock
  for (const item of orderData.items) {
    const product = products.find(p => p.id === item.productId)
    if (!product || product.stockQuantity < item.quantity) {
      throw new ApiError(400, `Insufficient stock for product ${product?.name || item.productId}`)
    }
  }

  // Calculate order totals
  const orderItems = orderData.items.map((item: any) => {
    const product = products.find(p => p.id === item.productId)!
    return {
      productId: item.productId,
      productNameSnapshot: product.name,
      unitPriceMinor: product.priceMinor,
      quantity: item.quantity,
      lineTotalMinor: product.priceMinor * item.quantity,
    }
  })

  const { subtotalMinor, totalMinor } = calculateOrderTotal(orderItems)

  // Atomic order creation
  const result = await prisma.$transaction(async (tx) => {
    // Upsert customer
    const customer = await tx.customer.upsert({
      where: {
        sellerId_phone: {
          sellerId: seller.id,
          phone: orderData.customerPhone,
        },
      },
      update: {
        name: orderData.customerName,
        addressText: orderData.customerAddress,
      },
      create: {
        sellerId: seller.id,
        name: orderData.customerName,
        phone: orderData.customerPhone,
        addressText: orderData.customerAddress,
      },
    })

    // Create order
    const order = await tx.order.create({
      data: {
        sellerId: seller.id,
        customerId: customer.id,
        publicOrderNumber: generatePublicOrderNumber(),
        subtotalMinor,
        totalMinor,
        currency: seller.currency,
        notes: orderData.notes,
        source: 'public_api',
      },
    })

    // Create order items
    await tx.orderItem.createMany({
      data: orderItems.map(item => ({
        orderId: order.id,
        productId: item.productId,
        productNameSnapshot: item.productNameSnapshot,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
      })),
    })

    // Create order event
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'order_created',
        payloadJson: {
          source: 'public_api',
          itemCount: orderItems.length,
          totalMinor,
        },
      },
    })

    // Enqueue notification job
    await tx.notificationJob.create({
      data: {
        sellerId: seller.id,
        orderId: order.id,
        channel: 'WHATSAPP',
        templateKey: 'new_order',
        status: 'PENDING',
      },
    })

    // Update stock
    for (const item of orderData.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: {
            decrement: item.quantity,
          },
        },
      })
    }

    return { order, customer }
  })

  logger.info('Order created successfully', {
    requestId,
    sellerId: seller.id,
    orderId: result.order.id,
    publicOrderNumber: result.order.publicOrderNumber,
    totalMinor: result.order.totalMinor,
  })

  const response = NextResponse.json({
    order: {
      id: result.order.id,
      publicOrderNumber: result.order.publicOrderNumber,
      status: result.order.status,
      subtotalMinor: result.order.subtotalMinor,
      totalMinor: result.order.totalMinor,
      currency: result.order.currency,
      createdAt: result.order.createdAt,
    },
    customer: {
      name: result.customer.name,
      phone: result.customer.phone,
    },
  }, { status: 201 })

  // Add rate limit headers
  Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
    response.headers.set(key, value)
  })

  return response
}

export const POST = withParamsValidation(
  SellerSlugSchema,
  (params, request) => 
    withValidation(CreateOrderSchema, (orderData, req) =>
      createOrder(params, orderData, req)
    )(request)
)
