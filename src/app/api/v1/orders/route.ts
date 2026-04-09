import { prisma } from '@/server/db/prisma'
import { getCurrentUser, requireSeller } from '@/server/lib/auth'
import { OrderCreateResponseSchema, OrderResponseSchema } from '@/shared/schemas/order-response'
import { CreateOrderSchema, GetOrdersSchema } from '@/shared/schemas/orders'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// === V1 ORDERS API ===
// Versioned API - NEVER BREAK COMPATIBILITY IN V1

// GET /api/v1/orders - List orders
export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/v1/orders - processing request');
    const user = await getCurrentUser(request)
    console.log('GET /api/v1/orders - user authenticated:', !!user);
    requireSeller(user)
    console.log('GET /api/v1/orders - seller verified');

    const { searchParams } = new URL(request.url)
    const query = GetOrdersSchema.parse({
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
      status: searchParams.get('status') || undefined,
      paymentStatus: searchParams.get('paymentStatus') || undefined,
      customerId: searchParams.get('customerId') || undefined,
    })

    const { page, limit } = query
    const skip = (page - 1) * limit

    const where = {
      sellerId: user.sellerId!,
      ...(query.status && { status: query.status }),
      ...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
      ...(query.customerId && { customerId: query.customerId }),
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

    // Build response according to V1 contract
    const response = {
      success: true,
      data: {
        orders: orders.map(order => ({
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
          items: order.orderItems.map(item => ({
            id: item.id,
            productId: item.productId,
            productNameSnapshot: item.productNameSnapshot,
            unitPriceMinor: item.unitPriceMinor,
            quantity: item.quantity,
            lineTotalMinor: item.lineTotalMinor,
          })),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    }

    // Enforce V1 response contract
    const safe = z.object({
      success: z.literal(true),
      data: z.object({
        orders: z.array(OrderResponseSchema),
        pagination: z.object({
          page: z.number().int().positive(),
          limit: z.number().int().positive(),
          total: z.number().int().nonnegative(),
          totalPages: z.number().int().nonnegative(),
          hasNext: z.boolean(),
          hasPrev: z.boolean(),
        }),
      }),
    }).parse(response)

    return NextResponse.json(safe)
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid query parameters",
          details: error.issues,
          timestamp: new Date().toISOString(),
        },
      }, { status: 400 })
    }

    console.error("V1 Orders GET error:", error)
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack)
      console.error("Error type:", error.constructor.name)
      console.error("Error message:", error.message)
    }

    // Handle ApiError instances with proper status codes
    if (error instanceof Error && error.constructor.name === 'ApiError') {
      const apiError = error as any;
      return NextResponse.json({
        success: false,
        error: {
          code: apiError.code || "INTERNAL_ERROR",
          message: apiError.message,
          timestamp: new Date().toISOString(),
        },
      }, { status: apiError.statusCode || 500 })
    }

    return NextResponse.json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch orders",
        details: error.message,
        timestamp: new Date().toISOString(),
      },
    }, { status: 500 })
  }
}

// POST /api/v1/orders - Create order
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request)
    requireSeller(user)

    const body = await request.json()

    // Validate input using V1 schema
    const validatedData = CreateOrderSchema.parse(body)

    // Calculate totals from items (would need product prices in real implementation)
    const subtotalMinor = validatedData.items.reduce(
      (sum, item) => sum + (item.quantity * 1000), // Mock price: 10.00 USD per item
      0
    )
    const deliveryFeeMinor = 500 // Mock delivery fee: 5.00 USD
    const totalMinor = subtotalMinor + deliveryFeeMinor

    // Generate public order number
    const publicOrderNumber = `ORD-${Date.now()}`

    // Verify customer belongs to the authenticated seller
    console.log('Customer verification - looking for:', {
      customerId: validatedData.customerId,
      sellerId: user.sellerId,
    });

    const customer = await prisma.customer.findFirst({
      where: {
        id: validatedData.customerId,
        sellerId: user.sellerId!,
      },
    });

    console.log('Customer verification result:', !!customer);
    if (!customer) {
      // Check what customers exist for this seller
      const allCustomers = await prisma.customer.findMany({
        where: { sellerId: user.sellerId! },
        select: { id: true, name: true },
      });
      console.log('All customers for seller:', allCustomers);

      return NextResponse.json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Customer not found or does not belong to seller",
          timestamp: new Date().toISOString(),
        },
      }, { status: 400 });
    }

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
            productNameSnapshot: `Product ${item.productId}`, // Use productId as name since no product table
            unitPriceMinor: 1000, // Mock price: 10.00 USD
            quantity: item.quantity,
            lineTotalMinor: item.quantity * 1000, // Calculate line total
          })),
        },
      },
      include: {
        customer: true,
        orderItems: true,
      },
    })

    // Build response according to V1 contract
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
    }

    // Enforce V1 response contract
    const safe = OrderCreateResponseSchema.parse(response)

    return NextResponse.json(safe)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input data",
          details: error.issues,
          timestamp: new Date().toISOString(),
        },
      }, { status: 400 })
    }

    if (error instanceof z.ZodError) {
      console.error("ZOD CONTRACT ERROR:", error.issues)
    } else {
      console.error("V1 Orders POST error:", error);
      if (error instanceof Error) {
        console.error("message:", error.message);
        console.error("stack:", error.stack);
      }
    }
    return NextResponse.json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to create order",
        timestamp: new Date().toISOString(),
      },
    }, { status: 500 })
  }
}
