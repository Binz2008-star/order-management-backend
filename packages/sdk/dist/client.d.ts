import { SdkConfig, PaginatedResponse, LoginResponse, CreateOrderRequest, Order, CreatePaymentRequest, Payment } from './types';
export declare class OrderManagementSDK {
    private client;
    private config;
    private authToken;
    constructor(config: SdkConfig);
    private setAuthToken;
    private clearAuthToken;
    private handleError;
    private getErrorCodeFromStatus;
    private request;
    private requestWithRetry;
    private delay;
    login(email: string, password: string): Promise<LoginResponse>;
    logout(): Promise<void>;
    getCurrentUser(): Promise<any>;
    refreshToken(): Promise<LoginResponse>;
    createOrder(orderData: CreateOrderRequest): Promise<Order>;
    getOrder(orderId: string): Promise<Order>;
    getOrders(params?: {
        page?: number;
        limit?: number;
        status?: string;
        customerId?: string;
    }): Promise<PaginatedResponse<Order>>;
    updateOrder(orderId: string, updateData: Partial<Order>): Promise<Order>;
    cancelOrder(orderId: string, reason?: string): Promise<Order>;
    createPayment(paymentData: CreatePaymentRequest): Promise<Payment>;
    getPayment(paymentId: string): Promise<Payment>;
    getPayments(params?: {
        page?: number;
        limit?: number;
        orderId?: string;
        status?: string;
    }): Promise<PaginatedResponse<Payment>>;
    updatePaymentStatus(paymentId: string, status: string): Promise<Payment>;
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
    }>;
    updateConfig(newConfig: Partial<SdkConfig>): void;
    getConfig(): SdkConfig;
}
//# sourceMappingURL=client.d.ts.map