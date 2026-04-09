// === RUNTIME CLIENT TYPES ===
// These types are used by sellora platform layer to communicate with runtime core

import { 
  CreateOrderInput, 
  UpdateOrderInput, 
  UpdateOrderStatusInput,
  GetOrdersQuery,
  CreatePaymentInput,
  UpdatePaymentStatusInput,
  RefundPaymentInput,
  CreateCustomerInput,
  ApiResponse,
  OrderResponse,
  ErrorResponse 
} from '../schemas/orders';

// === RUNTIME CLIENT INTERFACE ===

export interface RuntimeClient {
  // === ORDER OPERATIONS ===
  orders: {
    create(data: CreateOrderInput): Promise<ApiResponse<{ order: OrderResponse }>>;
    get(id: string): Promise<ApiResponse<{ order: OrderResponse }>>;
    list(query: GetOrdersQuery): Promise<ApiResponse<{ orders: OrderResponse[]; pagination: any }>>;
    update(id: string, data: UpdateOrderInput): Promise<ApiResponse<{ order: OrderResponse }>>;
    updateStatus(id: string, data: UpdateOrderStatusInput): Promise<ApiResponse<{ order: OrderResponse }>>;
    getEvents(id: string): Promise<ApiResponse<{ events: any[] }>>;
  };

  // === PAYMENT OPERATIONS ===
  payments: {
    create(orderId: string, data: CreatePaymentInput): Promise<ApiResponse<{ payment: any }>>;
    get(id: string): Promise<ApiResponse<{ payment: any }>>;
    list(query?: { orderId?: string }): Promise<ApiResponse<{ payments: any[] }>>;
    updateStatus(id: string, data: UpdatePaymentStatusInput): Promise<ApiResponse<{ payment: any }>>;
    refund(id: string, data: RefundPaymentInput): Promise<ApiResponse<{ payment: any }>>;
  };

  // === CUSTOMER OPERATIONS ===
  customers: {
    create(data: CreateCustomerInput): Promise<ApiResponse<{ customer: any }>>;
    get(id: string): Promise<ApiResponse<{ customer: any }>>;
    list(query?: { page?: number; limit?: number }): Promise<ApiResponse<{ customers: any[] }>>;
  };

  // === AUTH OPERATIONS ===
  auth: {
    login(credentials: { email: string; password: string }): Promise<ApiResponse<{ user: any; token: string }>>;
    refresh(refreshToken: string): Promise<ApiResponse<{ token: string }>>;
    me(): Promise<ApiResponse<{ user: any }>>;
  };
}

// === HTTP CLIENT CONFIG ===

export interface RuntimeClientConfig {
  baseURL: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
}

// === ERROR TYPES ===

export class RuntimeApiError extends Error {
  constructor(
    public response: ErrorResponse,
    public status: number
  ) {
    super(response.error.message);
    this.name = 'RuntimeApiError';
  }
}

// === REQUEST/RESPONSE INTERFACES ===

export interface RuntimeRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
}

export interface RuntimeResponse<T = any> extends ApiResponse<T> {
  status: number;
  headers: Record<string, string>;
}

// === AUTH TOKEN INTERFACE ===

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

// === CLIENT FACTORY ===

export interface RuntimeClientFactory {
  create(config: RuntimeClientConfig): RuntimeClient;
  createWithTokens(tokens: AuthTokens, config: RuntimeClientConfig): RuntimeClient;
}

// === EXPORTS ===

export type { 
  CreateOrderInput,
  UpdateOrderInput, 
  UpdateOrderStatusInput,
  GetOrdersQuery,
  CreatePaymentInput,
  UpdatePaymentStatusInput,
  RefundPaymentInput,
  CreateCustomerInput,
  ApiResponse,
  OrderResponse,
  ErrorResponse 
};
