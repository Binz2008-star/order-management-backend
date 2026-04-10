import { prisma } from "@/server/db/prisma";
import { createOrderEvent } from "@/server/modules/orders/order-events.authority";

interface ExternalIdTranslationMap {
  [externalId: string]: string;
}

const MOCK_EXTERNAL_ID_MAP: ExternalIdTranslationMap = {
  seller_123: "cmnri82ru0002114g5uxxnwrv",
  customer_456: "cmnri832g0004114gjldbisln",
  product_789: "cmnri82ru0002114g5uxxnwrv",
};

export interface CreateV1OrderCommand {
  sellerId: string;
  customerId: string;
  paymentType: string;
  paymentStatus: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
}

export interface V1OrderResult {
  id: string;
  sellerId: string;
  publicOrderNumber: string;
  status: string;
  paymentStatus: string;
  paymentType: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  currency: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: string;
    name: string;
    phone: string;
    addressText: string | null;
  };
  orderItems: Array<{
    id: string;
    productId: string;
    productNameSnapshot: string;
    unitPriceMinor: number;
    quantity: number;
    lineTotalMinor: number;
  }>;
}

async function translateExternalId(value: string, type: "seller" | "customer" | "product") {
  const cuid = MOCK_EXTERNAL_ID_MAP[value];
  if (!cuid) {
    throw new Error(`Unknown external ${type} ID: ${value}`);
  }
  return cuid;
}

function calculateTotals(items: Array<{ quantity: number }>) {
  const subtotalMinor = items.reduce((sum, item) => sum + item.quantity * 1000, 0);
  const deliveryFeeMinor = 500;
  const totalMinor = subtotalMinor + deliveryFeeMinor;
  return { subtotalMinor, deliveryFeeMinor, totalMinor };
}

export async function createV1Order(command: CreateV1OrderCommand, actorSellerId: string): Promise<V1OrderResult> {
  const translatedSellerId = await translateExternalId(command.sellerId, "seller");
  const translatedCustomerId = await translateExternalId(command.customerId, "customer");
  const translatedItems = await Promise.all(
    command.items.map(async (item) => ({
      ...item,
      productId: await translateExternalId(item.productId, "product"),
    }))
  );

  if (translatedSellerId !== actorSellerId) {
    throw new Error(
      `Seller ID mismatch: external ${command.sellerId} maps to ${translatedSellerId}, but authenticated user is ${actorSellerId}`
    );
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: {
        id: translatedCustomerId,
        sellerId: actorSellerId,
      },
    });

    if (!customer) {
      throw new Error("Customer not found or does not belong to seller");
    }

    const totals = calculateTotals(translatedItems);

    const order = await tx.order.create({
      data: {
        sellerId: actorSellerId,
        customerId: translatedCustomerId,
        publicOrderNumber: `ORD-${Date.now()}`,
        status: "PENDING",
        paymentType: command.paymentType,
        paymentStatus: command.paymentStatus,
        subtotalMinor: totals.subtotalMinor,
        deliveryFeeMinor: totals.deliveryFeeMinor,
        totalMinor: totals.totalMinor,
        currency: "USD",
        notes: command.notes,
        orderItems: {
          create: translatedItems.map((item) => ({
            productId: item.productId,
            productNameSnapshot: `Product ${item.productId}`,
            unitPriceMinor: 1000,
            quantity: item.quantity,
            lineTotalMinor: item.quantity * 1000,
          })),
        },
      },
      include: {
        customer: true,
        orderItems: true,
      },
    });

    await createOrderEvent(tx, {
      orderId: order.id,
      eventType: "order_created",
      payload: {
        source: "v1_api",
        itemCount: order.orderItems.length,
      },
    });

    return order;
  });
}
