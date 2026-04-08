import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/server/db/prisma";
import {
  calculateOrderTotal,
  generatePublicOrderNumber,
} from "@/server/lib/utils";
import { createOrderEvent } from "@/server/services/order-event.service";

const createOrderSchema = z.object({
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().min(5).max(30),
  addressText: z.string().min(1).max(500),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  notes: z.string().max(1000).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sellerSlug: string }> }
) {
  try {
    const { sellerSlug } = await params;

    const seller = await prisma.seller.findUnique({
      where: { slug: sellerSlug },
      select: {
        id: true,
        brandName: true,
        slug: true,
      },
    });

    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    const orders = await prisma.order.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        publicOrderNumber: true,
        status: true,
        paymentStatus: true,
        totalMinor: true,
        currency: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      seller,
      orders,
    });
  } catch (error) {
    console.error("Get orders error:", error);

    return NextResponse.json(
      { error: "Failed to get orders" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sellerSlug: string }> }
) {
  try {
    const { sellerSlug } = await params;
    const rawBody = await request.json();
    const body = createOrderSchema.parse(rawBody);

    const seller = await prisma.seller.findUnique({
      where: { slug: sellerSlug },
      select: {
        id: true,
        brandName: true,
        currency: true,
        slug: true,
      },
    });

    if (!seller) {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }

    // Products now handled by platform layer - validate productIds externally
    const _requestedProductIds = [...new Set(body.items.map((i) => i.productId))];

    // TODO: Validate productIds against platform API
    // For now, accept all productIds as valid (platform validation needed)

    // Product validation moved to platform layer
    // Runtime only stores product snapshots from request data

    const pricedItems = body.items.map((item: any) => ({
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot || `Product ${item.productId}`,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.unitPriceMinor * item.quantity,
    }));

    const totals = calculateOrderTotal(
      pricedItems.map((item) => ({
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
      })),
      0
    );

    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: {
          sellerId_phone: {
            sellerId: seller.id,
            phone: body.customerPhone,
          },
        },
        update: {
          name: body.customerName,
          addressText: body.addressText,
        },
        create: {
          sellerId: seller.id,
          name: body.customerName,
          phone: body.customerPhone,
          addressText: body.addressText,
        },
      });

      // Product stock management moved to platform layer
      // Runtime only stores order data with product snapshots

      const order = await tx.order.create({
        data: {
          sellerId: seller.id,
          customerId: customer.id,
          publicOrderNumber: generatePublicOrderNumber(),
          subtotalMinor: totals.subtotalMinor,
          deliveryFeeMinor: totals.deliveryFeeMinor,
          totalMinor: totals.totalMinor,
          currency: seller.currency,
          source: "public_api",
          notes: body.notes ?? "",
          status: "PENDING",
          paymentStatus: "PENDING",
        },
      });

      // Create order items
      await tx.orderItem.createMany({
        data: pricedItems.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          productNameSnapshot: item.productNameSnapshot,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
      });

      // Create order event using centralized event authority
      await createOrderEvent(tx, {
        orderId: order.id,
        actorUserId: null, // Public API - no actor
        eventType: "order_created",
        payload: {
          source: "public_api",
          customerPhone: body.customerPhone,
          itemCount: body.items.length,
        },
      });

      return { order, customer };
    }, { timeout: 15000, maxWait: 5000 });

    // Fetch the complete order with items
    const orderWithItems = await prisma.order.findUnique({
      where: { id: created.order.id },
      include: {
        orderItems: true,
      },
    });

    return NextResponse.json(
      {
        id: orderWithItems!.id,
        publicOrderNumber: orderWithItems!.publicOrderNumber,
        status: orderWithItems!.status,
        paymentStatus: orderWithItems!.paymentStatus,
        subtotalMinor: orderWithItems!.subtotalMinor,
        deliveryFeeMinor: orderWithItems!.deliveryFeeMinor,
        totalMinor: orderWithItems!.totalMinor,
        currency: orderWithItems!.currency,
        customer: {
          id: created.customer.id,
          name: created.customer.name,
          phone: created.customer.phone,
          addressText: created.customer.addressText,
        },
        items: orderWithItems!.orderItems,
        createdAt: orderWithItems!.createdAt,
      },
      { status: 201 }
    );
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
