"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SdkConfigSchema = exports.ErrorCodeSchema = exports.ApiErrorSchema = exports.PaginatedResponseSchema = exports.ApiResponseSchema = exports.PaymentSchema = exports.CreatePaymentRequestSchema = exports.PaymentMethodSchema = exports.PaymentStatusSchema = exports.OrderSchema = exports.CreateOrderRequestSchema = exports.OrderStatusSchema = exports.LoginResponseSchema = exports.LoginRequestSchema = exports.AuthTokenPayloadSchema = exports.UserRoleSchema = void 0;
const zod_1 = require("zod");
// === AUTH TYPES ===
exports.UserRoleSchema = zod_1.z.enum(['STAFF', 'SELLER', 'ADMIN']);
exports.AuthTokenPayloadSchema = zod_1.z.object({
    id: zod_1.z.string(),
    email: zod_1.z.string().email(),
    role: exports.UserRoleSchema,
    sellerId: zod_1.z.string().nullable(),
    iat: zod_1.z.number().optional(),
    exp: zod_1.z.number().optional(),
    iss: zod_1.z.string().optional(),
    aud: zod_1.z.string().optional(),
});
exports.LoginRequestSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
exports.LoginResponseSchema = zod_1.z.object({
    user: zod_1.z.object({
        id: zod_1.z.string(),
        email: zod_1.z.string().email(),
        role: exports.UserRoleSchema,
        sellerId: zod_1.z.string().nullable(),
        fullName: zod_1.z.string(),
        isActive: zod_1.z.boolean(),
    }),
    token: zod_1.z.string(),
    expiresIn: zod_1.z.string(),
});
// === ORDER TYPES ===
exports.OrderStatusSchema = zod_1.z.enum([
    'PENDING',
    'CONFIRMED',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED'
]);
exports.CreateOrderRequestSchema = zod_1.z.object({
    customerId: zod_1.z.string(),
    items: zod_1.z.array(zod_1.z.object({
        productId: zod_1.z.string(),
        quantity: zod_1.z.number().min(1),
        price: zod_1.z.number().min(0),
    })),
    shippingAddress: zod_1.z.object({
        street: zod_1.z.string(),
        city: zod_1.z.string(),
        state: zod_1.z.string(),
        zipCode: zod_1.z.string(),
        country: zod_1.z.string(),
    }),
});
exports.OrderSchema = zod_1.z.object({
    id: zod_1.z.string(),
    customerId: zod_1.z.string(),
    status: exports.OrderStatusSchema,
    totalAmount: zod_1.z.number(),
    items: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        productId: zod_1.z.string(),
        quantity: zod_1.z.number(),
        price: zod_1.z.number(),
    })),
    shippingAddress: zod_1.z.object({
        street: zod_1.z.string(),
        city: zod_1.z.string(),
        state: zod_1.z.string(),
        zipCode: zod_1.z.string(),
        country: zod_1.z.string(),
    }),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
// === PAYMENT TYPES ===
exports.PaymentStatusSchema = zod_1.z.enum([
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'REFUNDED'
]);
exports.PaymentMethodSchema = zod_1.z.enum([
    'CREDIT_CARD',
    'DEBIT_CARD',
    'PAYPAL',
    'STRIPE',
    'BANK_TRANSFER'
]);
exports.CreatePaymentRequestSchema = zod_1.z.object({
    orderId: zod_1.z.string(),
    amount: zod_1.z.number().min(0),
    currency: zod_1.z.string().length(3),
    method: exports.PaymentMethodSchema,
    paymentDetails: zod_1.z.record(zod_1.z.unknown()),
});
exports.PaymentSchema = zod_1.z.object({
    id: zod_1.z.string(),
    orderId: zod_1.z.string(),
    amount: zod_1.z.number(),
    currency: zod_1.z.string(),
    status: exports.PaymentStatusSchema,
    method: exports.PaymentMethodSchema,
    provider: zod_1.z.string(),
    providerTransactionId: zod_1.z.string().nullable(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
// === API RESPONSE TYPES ===
exports.ApiResponseSchema = zod_1.z.object({
    success: zod_1.z.boolean(),
    data: zod_1.z.unknown().optional(),
    error: zod_1.z.object({
        code: zod_1.z.string(),
        message: zod_1.z.string(),
        details: zod_1.z.unknown().optional(),
    }).optional(),
});
exports.PaginatedResponseSchema = zod_1.z.object({
    data: zod_1.z.array(zod_1.z.unknown()),
    pagination: zod_1.z.object({
        page: zod_1.z.number(),
        limit: zod_1.z.number(),
        total: zod_1.z.number(),
        totalPages: zod_1.z.number(),
    }),
});
// === ERROR TYPES ===
exports.ApiErrorSchema = zod_1.z.object({
    code: zod_1.z.string(),
    message: zod_1.z.string(),
    statusCode: zod_1.z.number(),
    details: zod_1.z.unknown().optional(),
});
exports.ErrorCodeSchema = zod_1.z.enum([
    'VALIDATION_ERROR',
    'AUTHENTICATION_ERROR',
    'AUTHORIZATION_ERROR',
    'NOT_FOUND',
    'CONFLICT',
    'RATE_LIMIT_EXCEEDED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE',
]);
// === CONFIGURATION TYPES ===
exports.SdkConfigSchema = zod_1.z.object({
    baseURL: zod_1.z.string().url(),
    timeout: zod_1.z.number().min(1000).default(10000),
    retryAttempts: zod_1.z.number().min(0).default(3),
    retryDelay: zod_1.z.number().min(100).default(1000),
});
//# sourceMappingURL=types.js.map