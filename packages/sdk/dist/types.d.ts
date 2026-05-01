import { z } from 'zod';
export declare const UserRoleSchema: z.ZodEnum<["STAFF", "SELLER", "ADMIN"]>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export declare const AuthTokenPayloadSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    role: z.ZodEnum<["STAFF", "SELLER", "ADMIN"]>;
    sellerId: z.ZodNullable<z.ZodString>;
    iat: z.ZodOptional<z.ZodNumber>;
    exp: z.ZodOptional<z.ZodNumber>;
    iss: z.ZodOptional<z.ZodString>;
    aud: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    email: string;
    role: "STAFF" | "SELLER" | "ADMIN";
    sellerId: string | null;
    iat?: number | undefined;
    exp?: number | undefined;
    iss?: string | undefined;
    aud?: string | undefined;
}, {
    id: string;
    email: string;
    role: "STAFF" | "SELLER" | "ADMIN";
    sellerId: string | null;
    iat?: number | undefined;
    exp?: number | undefined;
    iss?: string | undefined;
    aud?: string | undefined;
}>;
export type AuthTokenPayload = z.infer<typeof AuthTokenPayloadSchema>;
export declare const LoginRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export declare const LoginResponseSchema: z.ZodObject<{
    user: z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        role: z.ZodEnum<["STAFF", "SELLER", "ADMIN"]>;
        sellerId: z.ZodNullable<z.ZodString>;
        fullName: z.ZodString;
        isActive: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        id: string;
        email: string;
        role: "STAFF" | "SELLER" | "ADMIN";
        sellerId: string | null;
        fullName: string;
        isActive: boolean;
    }, {
        id: string;
        email: string;
        role: "STAFF" | "SELLER" | "ADMIN";
        sellerId: string | null;
        fullName: string;
        isActive: boolean;
    }>;
    token: z.ZodString;
    expiresIn: z.ZodString;
}, "strip", z.ZodTypeAny, {
    user: {
        id: string;
        email: string;
        role: "STAFF" | "SELLER" | "ADMIN";
        sellerId: string | null;
        fullName: string;
        isActive: boolean;
    };
    token: string;
    expiresIn: string;
}, {
    user: {
        id: string;
        email: string;
        role: "STAFF" | "SELLER" | "ADMIN";
        sellerId: string | null;
        fullName: string;
        isActive: boolean;
    };
    token: string;
    expiresIn: string;
}>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export declare const OrderStatusSchema: z.ZodEnum<["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export declare const CreateOrderRequestSchema: z.ZodObject<{
    customerId: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        productId: z.ZodString;
        quantity: z.ZodNumber;
        price: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        productId: string;
        quantity: number;
        price: number;
    }, {
        productId: string;
        quantity: number;
        price: number;
    }>, "many">;
    shippingAddress: z.ZodObject<{
        street: z.ZodString;
        city: z.ZodString;
        state: z.ZodString;
        zipCode: z.ZodString;
        country: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    }, {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    }>;
}, "strip", z.ZodTypeAny, {
    customerId: string;
    items: {
        productId: string;
        quantity: number;
        price: number;
    }[];
    shippingAddress: {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    };
}, {
    customerId: string;
    items: {
        productId: string;
        quantity: number;
        price: number;
    }[];
    shippingAddress: {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    };
}>;
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
export declare const OrderSchema: z.ZodObject<{
    id: z.ZodString;
    customerId: z.ZodString;
    status: z.ZodEnum<["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]>;
    totalAmount: z.ZodNumber;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        productId: z.ZodString;
        quantity: z.ZodNumber;
        price: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        productId: string;
        quantity: number;
        price: number;
    }, {
        id: string;
        productId: string;
        quantity: number;
        price: number;
    }>, "many">;
    shippingAddress: z.ZodObject<{
        street: z.ZodString;
        city: z.ZodString;
        state: z.ZodString;
        zipCode: z.ZodString;
        country: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    }, {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    }>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
    id: string;
    customerId: string;
    items: {
        id: string;
        productId: string;
        quantity: number;
        price: number;
    }[];
    shippingAddress: {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    };
    totalAmount: number;
    createdAt: string;
    updatedAt: string;
}, {
    status: "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
    id: string;
    customerId: string;
    items: {
        id: string;
        productId: string;
        quantity: number;
        price: number;
    }[];
    shippingAddress: {
        street: string;
        city: string;
        state: string;
        zipCode: string;
        country: string;
    };
    totalAmount: number;
    createdAt: string;
    updatedAt: string;
}>;
export type Order = z.infer<typeof OrderSchema>;
export declare const PaymentStatusSchema: z.ZodEnum<["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export declare const PaymentMethodSchema: z.ZodEnum<["CREDIT_CARD", "DEBIT_CARD", "PAYPAL", "STRIPE", "BANK_TRANSFER"]>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export declare const CreatePaymentRequestSchema: z.ZodObject<{
    orderId: z.ZodString;
    amount: z.ZodNumber;
    currency: z.ZodString;
    method: z.ZodEnum<["CREDIT_CARD", "DEBIT_CARD", "PAYPAL", "STRIPE", "BANK_TRANSFER"]>;
    paymentDetails: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    amount: number;
    currency: string;
    method: "CREDIT_CARD" | "DEBIT_CARD" | "PAYPAL" | "STRIPE" | "BANK_TRANSFER";
    paymentDetails: Record<string, unknown>;
}, {
    orderId: string;
    amount: number;
    currency: string;
    method: "CREDIT_CARD" | "DEBIT_CARD" | "PAYPAL" | "STRIPE" | "BANK_TRANSFER";
    paymentDetails: Record<string, unknown>;
}>;
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;
export declare const PaymentSchema: z.ZodObject<{
    id: z.ZodString;
    orderId: z.ZodString;
    amount: z.ZodNumber;
    currency: z.ZodString;
    status: z.ZodEnum<["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]>;
    method: z.ZodEnum<["CREDIT_CARD", "DEBIT_CARD", "PAYPAL", "STRIPE", "BANK_TRANSFER"]>;
    provider: z.ZodString;
    providerTransactionId: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "PENDING" | "PROCESSING" | "CANCELLED" | "REFUNDED" | "COMPLETED" | "FAILED";
    id: string;
    createdAt: string;
    updatedAt: string;
    orderId: string;
    amount: number;
    currency: string;
    method: "CREDIT_CARD" | "DEBIT_CARD" | "PAYPAL" | "STRIPE" | "BANK_TRANSFER";
    provider: string;
    providerTransactionId: string | null;
}, {
    status: "PENDING" | "PROCESSING" | "CANCELLED" | "REFUNDED" | "COMPLETED" | "FAILED";
    id: string;
    createdAt: string;
    updatedAt: string;
    orderId: string;
    amount: number;
    currency: string;
    method: "CREDIT_CARD" | "DEBIT_CARD" | "PAYPAL" | "STRIPE" | "BANK_TRANSFER";
    provider: string;
    providerTransactionId: string | null;
}>;
export type Payment = z.infer<typeof PaymentSchema>;
export declare const ApiResponseSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: unknown;
    }, {
        code: string;
        message: string;
        details?: unknown;
    }>>;
}, "strip", z.ZodTypeAny, {
    success: boolean;
    data?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    } | undefined;
}, {
    success: boolean;
    data?: unknown;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    } | undefined;
}>;
export type ApiResponse<T = unknown> = z.infer<typeof ApiResponseSchema> & {
    data?: T;
};
export declare const PaginatedResponseSchema: z.ZodObject<{
    data: z.ZodArray<z.ZodUnknown, "many">;
    pagination: z.ZodObject<{
        page: z.ZodNumber;
        limit: z.ZodNumber;
        total: z.ZodNumber;
        totalPages: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    }, {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    }>;
}, "strip", z.ZodTypeAny, {
    data: unknown[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}, {
    data: unknown[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}>;
export type PaginatedResponse<T = unknown> = {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};
export declare const ApiErrorSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    statusCode: z.ZodNumber;
    details: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
}, {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
}>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export declare const ErrorCodeSchema: z.ZodEnum<["VALIDATION_ERROR", "AUTHENTICATION_ERROR", "AUTHORIZATION_ERROR", "NOT_FOUND", "CONFLICT", "RATE_LIMIT_EXCEEDED", "INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE"]>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export declare const SdkConfigSchema: z.ZodObject<{
    baseURL: z.ZodString;
    timeout: z.ZodDefault<z.ZodNumber>;
    retryAttempts: z.ZodDefault<z.ZodNumber>;
    retryDelay: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    baseURL: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
}, {
    baseURL: string;
    timeout?: number | undefined;
    retryAttempts?: number | undefined;
    retryDelay?: number | undefined;
}>;
export type SdkConfig = z.infer<typeof SdkConfigSchema>;
//# sourceMappingURL=types.d.ts.map