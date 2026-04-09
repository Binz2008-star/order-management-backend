// === RUNTIME CLIENT IMPLEMENTATION ===
// Type-safe HTTP client for sellora platform to communicate with runtime core

import { RuntimeClient, RuntimeClientConfig, RuntimeApiError, AuthTokens, RuntimeRequestOptions } from './types';

// === HTTP CLIENT IMPLEMENTATION ===

export class OrderManagementRuntimeClient implements RuntimeClient {
  private config: RuntimeClientConfig;
  private tokens?: AuthTokens;

  constructor(config: RuntimeClientConfig, tokens?: AuthTokens) {
    this.config = {
      timeout: 10000,
      retryAttempts: 3,
      ...config,
    };
    this.tokens = tokens;
  }

  // === PRIVATE HTTP METHODS ===

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit & { validateResponse?: (response: any) => T } = {}
  ): Promise<T> {
    const url = `${this.config.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
      ...this.config.headers,
    };

    // Add auth token if available
    if (this.tokens?.accessToken) {
      headers.Authorization = `Bearer ${this.tokens.accessToken}`;
    }

    const requestOptions: RequestInit = {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    };

    let lastError: Error | null = null;
    
    // Retry logic
    for (let attempt = 1; attempt <= (this.config.retryAttempts || 3); attempt++) {
      try {
        const response = await fetch(url, requestOptions);
        const data = await response.json();

        if (!response.ok) {
          throw new RuntimeApiError(data, response.status);
        }

        // Validate response if validator provided
        if (options.validateResponse) {
          return options.validateResponse(data);
        }

        return data as T;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on client errors (4xx)
        if (error instanceof RuntimeApiError && error.status >= 400 && error.status < 500) {
          throw error;
        }

        // Retry on server errors or network issues
        if (attempt < (this.config.retryAttempts || 3)) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  // === AUTH OPERATIONS ===

  async auth: RuntimeClient['auth'] = {
    login: async (credentials) => {
      const response = await this.makeRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      // Store tokens for future requests
      if (response.success && response.data?.token) {
        this.tokens = {
          accessToken: response.data.token,
          refreshToken: response.data.refreshToken || '',
          expiresAt: response.data.expiresAt,
        };
      }

      return response;
    },

    refresh: async (refreshToken) => {
      const response = await this.makeRequest('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });

      // Update tokens
      if (response.success && response.data?.token) {
        this.tokens = {
          accessToken: response.data.token,
          refreshToken: response.data.refreshToken || refreshToken,
          expiresAt: response.data.expiresAt,
        };
      }

      return response;
    },

    me: async () => {
      return this.makeRequest('/api/me');
    },
  };

  // === ORDER OPERATIONS ===

  orders: RuntimeClient['orders'] = {
    create: async (data) => {
      return this.makeRequest('/api/seller/orders', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    get: async (id) => {
      return this.makeRequest(`/api/seller/orders/${id}`);
    },

    list: async (query) => {
      const params = new URLSearchParams(query as any).toString();
      return this.makeRequest(`/api/seller/orders?${params}`);
    },

    update: async (id, data) => {
      return this.makeRequest(`/api/seller/orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    updateStatus: async (id, data) => {
      return this.makeRequest(`/api/seller/orders/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    getEvents: async (id) => {
      return this.makeRequest(`/api/seller/orders/${id}/events`);
    },
  };

  // === PAYMENT OPERATIONS ===

  payments: RuntimeClient['payments'] = {
    create: async (orderId, data) => {
      return this.makeRequest(`/api/seller/orders/${orderId}/payments/create`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    get: async (id) => {
      return this.makeRequest(`/api/seller/payments/${id}`);
    },

    list: async (query) => {
      const params = query ? new URLSearchParams(query as any).toString() : '';
      return this.makeRequest(`/api/seller/payments${params ? '?' + params : ''}`);
    },

    updateStatus: async (id, data) => {
      return this.makeRequest(`/api/seller/payments/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    refund: async (id, data) => {
      return this.makeRequest(`/api/seller/payments/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  };

  // === CUSTOMER OPERATIONS ===

  customers: RuntimeClient['customers'] = {
    create: async (data) => {
      return this.makeRequest('/api/seller/customers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    get: async (id) => {
      return this.makeRequest(`/api/seller/customers/${id}`);
    },

    list: async (query) => {
      const params = query ? new URLSearchParams(query as any).toString() : '';
      return this.makeRequest(`/api/seller/customers${params ? '?' + params : ''}`);
    },
  };

  // === UTILITY METHODS ===

  setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  getTokens(): AuthTokens | undefined {
    return this.tokens;
  }

  clearTokens(): void {
    this.tokens = undefined;
  }

  isAuthenticated(): boolean {
    return !!this.tokens?.accessToken;
  }
}

// === CLIENT FACTORY ===

export class RuntimeClientFactory {
  static create(config: RuntimeClientConfig): OrderManagementRuntimeClient {
    return new OrderManagementRuntimeClient(config);
  }

  static createWithTokens(
    tokens: AuthTokens,
    config: RuntimeClientConfig
  ): OrderManagementRuntimeClient {
    return new OrderManagementRuntimeClient(config, tokens);
  }
}

// === EXPORTS ===

export { OrderManagementRuntimeClient as RuntimeClientImpl };
