import { PaginatedResponse, SdkConfig } from './types';
declare global {
    var window: {
        localStorage: Storage;
        sessionStorage: Storage;
    } | undefined;
    var localStorage: Storage | undefined;
    var sessionStorage: Storage | undefined;
}
export declare class OrderManagementSDK {
    private client;
    private config;
    constructor(config: SdkConfig);
    private getAuthToken;
    private setAuthToken;
    private clearAuthToken;
    private handleError;
    private getErrorCodeFromStatus;
    private request;
    private requestWithRetry;
    private delay;
    login(email: string, password: string): Promise<any>;
    logout(): Promise<void>;
    getCurrentUser(): Promise<any>;
    refreshToken(): Promise<any>;
    createOrder(orderData: any): Promise<any>;
    getOrder(orderId: string): Promise<any>;
    getOrders(params?: {
        page?: number;
        limit?: number;
        status?: string;
        customerId?: string;
    }): Promise<PaginatedResponse<any>>;
    updateOrder(orderId: string, updateData: any): Promise<any>;
    cancelOrder(orderId: string, reason?: string): Promise<any>;
    createPayment(paymentData: any): Promise<any>;
    getPayment(paymentId: string): Promise<any>;
    getPayments(params?: {
        page?: number;
        limit?: number;
        orderId?: string;
        status?: string;
    }): Promise<PaginatedResponse<any>>;
    updatePaymentStatus(paymentId: string, status: string): Promise<any>;
    healthCheck(): Promise<{
        status: string;
        timestamp: string;
    }>;
    updateConfig(newConfig: Partial<SdkConfig>): void;
    getConfig(): SdkConfig;
}
//# sourceMappingURL=client-complex.d.ts.map