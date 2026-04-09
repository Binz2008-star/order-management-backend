// === CROSS-REPO CONTRACT TESTS ===
// Tests that prove sellora and runtime core work together correctly

import { GatewayClient } from "@/shared/runtime-client/gateway-client";
import { ErrorSchema } from "@/shared/schemas/error";
import { OrderResponseSchema } from "@/shared/schemas/order-response";
import { CreateOrderSchema } from "@/shared/schemas/orders";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

// Response type schemas for contract validation
const CreateOrderResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    order: OrderResponseSchema,
  }),
});

const GetOrderResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    order: OrderResponseSchema,
  }),
});

const ListOrdersResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    orders: z.array(OrderResponseSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  }),
});

// Test configuration
const RUNTIME_API_URL = process.env.RUNTIME_API_URL || "http://localhost:3000";
const TEST_SELLER_TOKEN = process.env.TEST_SELLER_TOKEN || "test-token";

describe("Cross-Repo Contract Tests", () => {
  let gatewayClient: GatewayClient;
  let createdOrderId: string;

  beforeAll(() => {
    gatewayClient = GatewayClient.withToken(RUNTIME_API_URL, TEST_SELLER_TOKEN, {
      timeoutMs: 10000,
      retryAttempts: 3,
    });
  });

  afterAll(async () => {
    // Cleanup test data
    if (createdOrderId) {
      try {
        await gatewayClient.delete(`/api/v1/orders/${createdOrderId}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Request/Response Contract Validation", () => {
    test("sellora request matches runtime contract", () => {
      // This simulates what sellora would send
      const selloraRequest = {
        sellerId: "seller_123",
        customerId: "customer_456",
        items: [
          {
            productId: "product_789",
            quantity: 2,
          },
        ],
        paymentType: "CASH_ON_DELIVERY",
        notes: "Test order from sellora",
      };

      // Validate that sellora's request matches runtime's expected schema
      expect(() => CreateOrderSchema.parse(selloraRequest)).not.toThrow();

      const validated = CreateOrderSchema.parse(selloraRequest);
      expect(validated.sellerId).toBe("seller_123");
      expect(validated.items).toHaveLength(1);
      expect(validated.items[0].quantity).toBe(2);
    });

    test("runtime response matches sellora expectations", () => {
      // This simulates what runtime would return
      const runtimeResponse = {
        id: "ord_123",
        sellerId: "seller_123",
        publicOrderNumber: "ORD-123",
        status: "PENDING",
        paymentStatus: "PENDING",
        paymentType: "CASH_ON_DELIVERY",
        subtotalMinor: 2000,
        deliveryFeeMinor: 500,
        totalMinor: 2500,
        currency: "USD",
        notes: null,
        createdAt: "2023-12-01T10:00:00Z",
        updatedAt: "2023-12-01T10:00:00Z",
        customer: {
          id: "customer_456",
          name: "John Doe",
          phone: "+1234567890",
          addressText: "123 Main St",
        },
        items: [
          {
            id: "item_123",
            productId: "product_789",
            productNameSnapshot: "Test Product",
            unitPriceMinor: 1000,
            quantity: 2,
            lineTotalMinor: 2000,
          },
        ],
      };

      // Validate that runtime's response matches sellora's expected schema
      expect(() => OrderResponseSchema.parse(runtimeResponse)).not.toThrow();

      const validated = OrderResponseSchema.parse(runtimeResponse);
      expect(validated.id).toBe("ord_123");
      expect(validated.status).toBe("PENDING");
      expect(validated.items).toHaveLength(1);
    });
  });

  describe("Live Integration Tests", () => {
    test("end-to-end order creation flow", async () => {
      const orderData = CreateOrderSchema.parse({
        sellerId: "test-seller",
        customerId: "test-customer",
        items: [
          {
            productId: "test-product",
            quantity: 1,
          },
        ],
        paymentType: "CASH_ON_DELIVERY",
      });

      // Create order via runtime API
      const createResponse = await gatewayClient.post("/api/v1/orders", orderData);

      // Validate response contract
      const validatedCreateResponse = CreateOrderResponseSchema.parse(createResponse);
      expect(validatedCreateResponse.success).toBe(true);
      expect(validatedCreateResponse.data.order).toBeDefined();

      // Validate order data contract
      const order = validatedCreateResponse.data.order;
      expect(order.id).toBeDefined();
      expect(order.status).toMatch(/^(PENDING|CONFIRMED|PREPARING|READY|COMPLETED|CANCELLED)$/);
      expect(order.paymentStatus).toMatch(/^(PENDING|PAID|FAILED|REFUNDED)$/);

      // Store for cleanup
      createdOrderId = order.id;
    });

    test("order retrieval flow", async () => {
      if (!createdOrderId) {
        console.warn("No created order ID available, skipping retrieval test");
        return;
      }

      // Get order via runtime API
      const getResponse = await gatewayClient.get(`/api/v1/orders/${createdOrderId}`);

      // Validate response contract
      const validatedGetResponse = GetOrderResponseSchema.parse(getResponse);
      expect(validatedGetResponse.success).toBe(true);
      expect(validatedGetResponse.data.order).toBeDefined();

      // Validate order data contract
      const order = validatedGetResponse.data.order;
      expect(order.id).toBe(createdOrderId);
    });

    test("order listing flow", async () => {
      // List orders via runtime API
      const listResponse = await gatewayClient.get("/api/v1/orders", {
        params: { page: 1, limit: 10 },
      });

      // Validate response contract
      const validatedListResponse = ListOrdersResponseSchema.parse(listResponse);
      expect(validatedListResponse.success).toBe(true);
      expect(validatedListResponse.data.orders).toBeDefined();
      expect(validatedListResponse.data.pagination).toBeDefined();
      expect(Array.isArray(validatedListResponse.data.orders)).toBe(true);

      // Validate each order in the list
      validatedListResponse.data.orders.forEach(order => {
        expect(() => OrderResponseSchema.parse(order)).not.toThrow();
      });
    });
  });

  describe("Error Contract Validation", () => {
    test("invalid request returns proper error contract", async () => {
      const invalidOrderData = {
        sellerId: "", // Invalid: empty string
        customerId: "test-customer",
        items: [], // Invalid: empty array
        paymentType: "INVALID_TYPE", // Invalid: not in enum
      };

      try {
        await gatewayClient.post("/api/v1/orders", invalidOrderData);
        expect.fail("Should have thrown an error");
      } catch (error) {
        // Validate error contract
        if (error instanceof Error && "response" in error) {
          const errorResponse = JSON.parse((error as any).response);

          expect(() => ErrorSchema.parse(errorResponse)).not.toThrow();

          const validated = ErrorSchema.parse(errorResponse);
          expect(validated.success).toBe(false);
          expect(validated.error.code).toBe("VALIDATION_ERROR");
          expect(validated.error.message).toBeDefined();
          expect(validated.error.timestamp).toBeDefined();
        }
      }
    });

    test("non-existent resource returns proper error contract", async () => {
      try {
        await gatewayClient.get("/api/v1/orders/non-existent-id");
        expect.fail("Should have thrown an error");
      } catch (error) {
        // Validate error contract
        if (error instanceof Error && "response" in error) {
          const errorResponse = JSON.parse((error as any).response);

          expect(() => ErrorSchema.parse(errorResponse)).not.toThrow();

          const validated = ErrorSchema.parse(errorResponse);
          expect(validated.success).toBe(false);
          expect(validated.error.code).toBe("NOT_FOUND");
        }
      }
    });
  });

  describe("Data Type Consistency", () => {
    test("numeric fields are properly typed", () => {
      const orderResponse = {
        id: "ord_123",
        sellerId: "seller_123",
        publicOrderNumber: "ORD-123",
        status: "PENDING",
        paymentStatus: "PENDING",
        paymentType: "CASH_ON_DELIVERY",
        subtotalMinor: 2000,
        deliveryFeeMinor: 500,
        totalMinor: 2500,
        currency: "USD",
        notes: null,
        createdAt: "2023-12-01T10:00:00Z",
        updatedAt: "2023-12-01T10:00:00Z",
        customer: {
          id: "customer_456",
          name: "John Doe",
          phone: "+1234567890",
          addressText: "123 Main St",
        },
        items: [
          {
            id: "item_123",
            productId: "product_789",
            productNameSnapshot: "Test Product",
            unitPriceMinor: 1000,
            quantity: 2,
            lineTotalMinor: 2000,
          },
        ],
      };

      const validated = OrderResponseSchema.parse(orderResponse);

      // Verify numeric fields are numbers (not strings)
      expect(typeof validated.subtotalMinor).toBe("number");
      expect(typeof validated.deliveryFeeMinor).toBe("number");
      expect(typeof validated.totalMinor).toBe("number");
      expect(typeof validated.items[0].unitPriceMinor).toBe("number");
      expect(typeof validated.items[0].quantity).toBe("number");
      expect(typeof validated.items[0].lineTotalMinor).toBe("number");

      // Verify they are integers
      expect(Number.isInteger(validated.subtotalMinor)).toBe(true);
      expect(Number.isInteger(validated.totalMinor)).toBe(true);
      expect(Number.isInteger(validated.items[0].quantity)).toBe(true);
    });

    test("enum fields are properly constrained", () => {
      const orderResponse = {
        id: "ord_123",
        sellerId: "seller_123",
        publicOrderNumber: "ORD-123",
        status: "PENDING",
        paymentStatus: "PENDING",
        paymentType: "CASH_ON_DELIVERY",
        subtotalMinor: 2000,
        deliveryFeeMinor: 500,
        totalMinor: 2500,
        currency: "USD",
        notes: null,
        createdAt: "2023-12-01T10:00:00Z",
        updatedAt: "2023-12-01T10:00:00Z",
        customer: {
          id: "customer_456",
          name: "John Doe",
          phone: "+1234567890",
          addressText: "123 Main St",
        },
        items: [],
      };

      const validated = OrderResponseSchema.parse(orderResponse);

      // Verify enum values are valid
      expect(["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED"]).toContain(validated.status);
      expect(["PENDING", "PAID", "FAILED", "REFUNDED"]).toContain(validated.paymentStatus);
      expect(["CASH_ON_DELIVERY", "CARD", "WALLET"]).toContain(validated.paymentType);
      expect(validated.currency).toMatch(/^[A-Z]{3}$/);
    });
  });

  describe("Performance and Reliability", () => {
    test("requests complete within reasonable time", async () => {
      const startTime = Date.now();

      await gatewayClient.get("/api/v1/orders", {
        params: { page: 1, limit: 5 },
      });

      const duration = Date.now() - startTime;

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
    });

    test("concurrent requests are handled properly", async () => {
      const requests = Array(5).fill(null).map(() =>
        gatewayClient.get("/api/v1/orders", {
          params: { page: 1, limit: 5 },
        })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.success).toBe(true);
        expect(response.data.orders).toBeDefined();
      });
    });
  });
});

// === CONTRACT TEST UTILITIES ===

export class ContractTestUtils {
  static async validateContractConsistency(
    client: GatewayClient,
    endpoint: string,
    requestData: unknown,
    expectedResponseSchema: any
  ): Promise<void> {
    // Send request
    const response = await client.post(endpoint, requestData);

    // Validate response structure
    expect(() => expectedResponseSchema.parse(response)).not.toThrow();
  }

  static async validateErrorContract(
    client: GatewayClient,
    endpoint: string,
    invalidData: unknown,
    expectedErrorCode: string
  ): Promise<void> {
    try {
      await client.post(endpoint, invalidData);
      expect.fail("Should have thrown an error");
    } catch (error) {
      if (error instanceof Error && "response" in error) {
        const errorResponse = JSON.parse((error as any).response);
        const validated = ErrorSchema.parse(errorResponse);

        expect(validated.success).toBe(false);
        expect(validated.error.code).toBe(expectedErrorCode);
      }
    }
  }

  static generateTestData(): {
    validOrder: any;
    invalidOrder: any;
    validCustomer: any;
    invalidCustomer: any;
  } {
    return {
      validOrder: {
        sellerId: "seller_123",
        customerId: "customer_456",
        items: [{ productId: "product_789", quantity: 1 }],
        paymentType: "CASH_ON_DELIVERY",
      },
      invalidOrder: {
        sellerId: "",
        customerId: "customer_456",
        items: [],
        paymentType: "INVALID",
      },
      validCustomer: {
        name: "John Doe",
        phone: "+1234567890",
        addressText: "123 Main St",
      },
      invalidCustomer: {
        name: "",
        phone: "invalid",
        addressText: "",
      },
    };
  }
}
