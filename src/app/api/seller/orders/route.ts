import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { withQueryValidation } from '@/server/lib/errors'
import { PaginationSchema } from '@/server/lib/validation'
import { CreateOrderSchema, GetOrdersSchema } from '@/shared/schemas/orders'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

type PaginationQuery = z.infer<typeof PaginationSchema>

async function getOrders(query: PaginationQuery, request: NextRequest) {
  const user = await getCurrentUser(request)
  requireSeller(user)

  const { page, limit, status } = query
  const skip = (page - 1) * limit

  const where = {
    sellerId: user.sellerId!,
    ...(status && { status }),
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        customer: true,
        orderItems: {
          select: {
            id: true,
            productId: true,
            productNameSnapshot: true,
            unitPriceMinor: true,
            quantity: true,
            lineTotalMinor: true,
          },
        },
        _count: {
          select: {
            events: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ])

  const totalPages = Math.ceil(total / limit)

  return NextResponse.json({
    orders: orders.map(order => ({
      id: order.id,
      publicOrderNumber: order.publicOrderNumber,
      status: order.status,
      paymentType: order.paymentType,
      paymentStatus: order.paymentStatus,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      totalMinor: order.totalMinor,
      currency: order.currency,
      source: order.source,
      notes: order.notes,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        phone: order.customer.phone,
        addressText: order.customer.addressText,
      },
      orderItems: order.orderItems,
      eventCount: order._count.events,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  })
}

// POST endpoint for creating orders with Zod validation
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request)
    requireSeller(user)

    const body = await request.json()

    // Validate input using Zod schema
    const validatedData = CreateOrderSchema.parse(body)

    // Calculate totals from items (would need product prices in real implementation)
    const subtotalMinor = 0 // TODO: Calculate from products
    const deliveryFeeMinor = 0
    const totalMinor = subtotalMinor + deliveryFeeMinor

    // Generate public order number
    const publicOrderNumber = `ORD-${Date.now()}`

    // Create order with validated data
    const order = await prisma.order.create({
      data: {
        sellerId: user.sellerId!,
        customerId: validatedData.customerId,
        publicOrderNumber,
        status: "PENDING",
        paymentType: validatedData.paymentType,
        paymentStatus: "PENDING",
        subtotalMinor,
        deliveryFeeMinor,
        totalMinor,
        currency: "USD", // TODO: Get from seller settings
        notes: validatedData.notes,
        orderItems: {
          create: validatedData.items.map(item => ({
            productId: item.productId,
            productNameSnapshot: "Product Name", // TODO: Get from product catalog
            unitPriceMinor: 0, // TODO: Get from product catalog
            quantity: item.quantity,
            lineTotalMinor: 0, // TODO: Calculate
          })),
        },
      },
      include: {
        customer: true,
        orderItems: true,
      },
    })

    // Build response object
    const response = {
      success: true,
      data: {
        order: {
          id: order.id,
          sellerId: order.sellerId,
          publicOrderNumber: order.publicOrderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentType: order.paymentType,
          subtotalMinor: order.subtotalMinor,
          deliveryFeeMinor: order.deliveryFeeMinor,
          totalMinor: order.totalMinor,
          currency: order.currency,
          notes: order.notes,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          customer: {
            id: order.customer.id,
            name: order.customer.name,
            phone: order.customer.phone,
            addressText: order.customer.addressText,
          },
          items: order.orderItems,
        },
      },
    };

    // Enforce output contract
    const safe = OrderCreateResponseSchema.parse(response);

    return NextResponse.json(safe);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: error.errors,
        },
      }, { status: 400 })
    }

    console.error("Create order error:", error)
    return NextResponse.json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to create order",
      },
    }, { status: 500 })
  }
}

export const GET = withQueryValidation(GetOrdersSchema, (data, request) =>
  getOrders(data, request)
)
