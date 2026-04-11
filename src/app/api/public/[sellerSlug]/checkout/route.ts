import { prisma } from '@/server/db/prisma';
import { calculateOrderTotals, validateOrderItems } from '@/server/lib/order-validation';
import { generatePublicOrderNumber } from "@/server/lib/utils";
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const checkoutSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().min(1, 'Customer phone is required'),
  addressText: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'At least one item is required'),
  notes: z.string().optional(),
  deliveryFeeMinor: z.number().int().min(0).default(0),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sellerSlug: string }> }
) {
  try {
    const { sellerSlug } = await params
    const body = await request.json()
    const parsedBody = checkoutSchema.parse(body)

    // Find seller
    const seller = await prisma.seller.findUnique({
      where: { slug: sellerSlug },
      select: {
        id: true,
        brandName: true,
        currency: true,
        slug: true,
      },
    })

    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    // Validate order items against platform catalog
    const validatedItems = await validateOrderItems(seller.id, parsedBody.items);

    // Calculate order totals
    const { subtotalMinor, deliveryFeeMinor, totalMinor } = calculateOrderTotals(
      validatedItems,
      parsedBody.deliveryFeeMinor
    );

    // Create customer if not exists
    const customer = await prisma.customer.upsert({
      where: {
        sellerId_phone: {
          sellerId: seller.id,
          phone: parsedBody.customerPhone,
        },
      },
      update: {
        name: parsedBody.customerName,
        addressText: parsedBody.addressText,
      },
      create: {
        sellerId: seller.id,
        name: parsedBody.customerName,
        phone: parsedBody.customerPhone,
        addressText: parsedBody.addressText,
      },
    });

    // Generate public order number
    const publicOrderNumber = generatePublicOrderNumber();

    // Create order with transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          sellerId: seller.id,
          customerId: customer.id,
          publicOrderNumber,
          status: "PENDING",
          paymentType: "CASH_ON_DELIVERY",
          paymentStatus: "PENDING",
          subtotalMinor,
          deliveryFeeMinor,
          totalMinor,
          currency: seller.currency,
          source: "public_api",
          notes: parsedBody.notes,
        },
      });

      // Create order items with validated platform data
      await tx.orderItem.createMany({
        data: validatedItems.map((item) => ({
          orderId: newOrder.id,
          productId: item.productId,
          productNameSnapshot: item.productNameSnapshot,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
      });

      return newOrder;
    });

    // Log audit event for order creation
    try {
      const { auditTrail } = await import('@/server/lib/audit-trail');
      await auditTrail.logOrderCreated(order.id, 'public_api', {
        sellerId: seller.id,
        customerId: customer.id,
        totalMinor: order.totalMinor,
        itemCount: validatedItems.length,
        source: 'public_api'
      });
    } catch (auditError) {
      console.warn('Audit logging failed:', auditError);
      // Continue without failing the order creation
    }

    // Fetch the complete order with items
    const orderWithItems = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        orderItems: true,
      },
    });

    return NextResponse.json({
      id: orderWithItems!.id,
      publicOrderNumber: orderWithItems!.publicOrderNumber,
      status: orderWithItems!.status,
      paymentStatus: orderWithItems!.paymentStatus,
      subtotalMinor: orderWithItems!.subtotalMinor,
      deliveryFeeMinor: orderWithItems!.deliveryFeeMinor,
      totalMinor: orderWithItems!.totalMinor,
      currency: orderWithItems!.currency,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        addressText: customer.addressText,
      },
      items: orderWithItems!.orderItems,
      createdAt: orderWithItems!.createdAt,
    }, { status: 201 });
  } catch (error) {
    console.error("Create order error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.flatten(),
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create order",
      },
      { status: 500 }
    );
  }
}
