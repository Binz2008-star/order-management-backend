// === AUTO-GENERATED RUNTIME SDK ===
// Generated from OpenAPI spec - DO NOT EDIT MANUALLY

import type { paths } from "./runtime-api";

export interface RuntimeClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  requestId?: string;
}

export class RuntimeSDK {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(options: RuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs || 10000;
  }

  private async request<T>(
    path: keyof paths,
    method: keyof paths[keyof paths],
    options?: RequestInit & { params?: Record<string, any> }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`, this.baseUrl);

    // Add query parameters
    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options?.headers as Record<string, string> || {}),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: method.toUpperCase(),
        headers,
        body: options?.body,
        signal: controller.signal,
        ...options,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // === ORDERS API ===

  /**
   * List orders with pagination and filtering
   */
  async getOrders(params?: paths["/api/v1/orders"]["get"]["parameters"]["query"]): Promise<
    paths["/api/v1/orders"]["get"]["responses"]["200"]["content"]["application/json"]
  > {
    return this.request("/api/v1/orders", "get", { params });
  }

  /**
   * Create a new order
   */
  async createOrder(body: paths["/api/v1/orders"]["post"]["requestBody"]["content"]["application/json"]): Promise<
    paths["/api/v1/orders"]["post"]["responses"]["201"]["content"]["application/json"]
  > {
    return this.request("/api/v1/orders", "post", { body: JSON.stringify(body) });
  }

  /**
   * Get a specific order by ID
   */
  async getOrder(id: string): Promise<
    paths["/api/v1/orders/{id}"]["get"]["responses"]["200"]["content"]["application/json"]
  > {
    return this.request(`/api/v1/orders/${id}` as any, "get");
  }

  /**
   * Update an existing order
   */
  async updateOrder(
    id: string,
    body: paths["/api/v1/orders/{id}"]["put"]["requestBody"]["content"]["application/json"]
  ): Promise<
    paths["/api/v1/orders/{id}"]["put"]["responses"]["200"]["content"]["application/json"]
  > {
    return this.request(`/api/v1/orders/${id}` as any, "put", { body: JSON.stringify(body) });
  }

  /**
   * Update order status
   */
  async updateOrderStatus(
    id: string,
    body: paths["/api/v1/orders/{id}/status"]["put"]["requestBody"]["content"]["application/json"]
  ): Promise<
    paths["/api/v1/orders/{id}/status"]["put"]["responses"]["200"]["content"]["application/json"]
  > {
    return this.request(`/api/v1/orders/${id}/status` as any, "put", { body: JSON.stringify(body) });
  }

  // === UTILITY METHODS ===

  /**
   * Check API health
   */
  async healthCheck(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/api/health`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Create authenticated client
   */
  static withToken(baseUrl: string, token: string, options?: Omit<RuntimeClientOptions, "baseUrl" | "token">): RuntimeSDK {
    return new RuntimeSDK({ baseUrl, token, ...options });
  }

  /**
   * Create anonymous client
   */
  static anonymous(baseUrl: string, options?: Omit<RuntimeClientOptions, "token">): RuntimeSDK {
    return new RuntimeSDK({ baseUrl, ...options });
  }
}

// === TYPE EXPORTS ===

export type {
  components, paths
} from "./runtime-api";

// === CONVENIENCE TYPES ===

export type CreateOrderRequest = paths["/api/v1/orders"]["post"]["requestBody"]["content"]["application/json"];
export type OrderResponse = paths["/api/v1/orders/{id}"]["get"]["responses"]["200"]["content"]["application/json"]["data"]["order"];
export type OrderListResponse = paths["/api/v1/orders"]["get"]["responses"]["200"]["content"]["application/json"];
export type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp?: string;
  };
};
