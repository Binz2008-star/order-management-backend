"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderManagementSDK = void 0;
const axios_1 = __importDefault(require("axios"));
const types_1 = require("./types");
class OrderManagementSDK {
    constructor(config) {
        // Validate configuration
        this.config = types_1.SdkConfigSchema.parse(config);
        // Create axios instance
        this.client = axios_1.default.create({
            baseURL: this.config.baseURL,
            timeout: this.config.timeout,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        // Add request interceptor for authentication
        this.client.interceptors.request.use((config) => {
            const token = this.getAuthToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        }, (error) => Promise.reject(error));
        // Add response interceptor for error handling
        this.client.interceptors.response.use((response) => response, (error) => {
            const apiError = this.handleError(error);
            return Promise.reject(apiError);
        });
    }
    getAuthToken() {
        // Get token from localStorage, sessionStorage, or memory
        if (typeof window !== 'undefined') {
            return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
        }
        return null;
    }
    setAuthToken(token) {
        if (typeof window !== 'undefined') {
            localStorage.setItem('authToken', token);
        }
    }
    clearAuthToken() {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('authToken');
            sessionStorage.removeItem('authToken');
        }
    }
    handleError(error) {
        if (error.response) {
            // Server responded with error status
            const statusCode = error.response.status;
            const response = error.response.data;
            // Try to parse as API response
            try {
                const apiResponse = types_1.ApiResponseSchema.parse(response);
                if (apiResponse.error) {
                    return {
                        code: apiResponse.error.code,
                        message: apiResponse.error.message,
                        statusCode,
                        details: apiResponse.error.details,
                    };
                }
            }
            catch {
                // Fallback to generic error
            }
            return {
                code: this.getErrorCodeFromStatus(statusCode),
                message: response.message || 'Request failed',
                statusCode,
                details: response,
            };
        }
        else if (error.request) {
            // Network error
            return {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Network error - please check your connection',
                statusCode: 0,
                details: error.request,
            };
        }
        else {
            // Other error
            return {
                code: 'INTERNAL_SERVER_ERROR',
                message: error.message || 'An unexpected error occurred',
                statusCode: 500,
                details: error,
            };
        }
    }
    getErrorCodeFromStatus(status) {
        switch (status) {
            case 400:
                return 'VALIDATION_ERROR';
            case 401:
                return 'AUTHENTICATION_ERROR';
            case 403:
                return 'AUTHORIZATION_ERROR';
            case 404:
                return 'NOT_FOUND';
            case 409:
                return 'CONFLICT';
            case 429:
                return 'RATE_LIMIT_EXCEEDED';
            case 503:
                return 'SERVICE_UNAVAILABLE';
            default:
                return 'INTERNAL_SERVER_ERROR';
        }
    }
    async request(config) {
        try {
            const response = await this.client.request(config);
            return response.data;
        }
        catch (error) {
            throw error; // Error already handled by interceptor
        }
    }
    async requestWithRetry(config) {
        let lastError;
        for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
            try {
                return await this.request(config);
            }
            catch (error) {
                lastError = error;
                // Don't retry on client errors (4xx)
                if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
                    throw error;
                }
                // Don't retry on last attempt
                if (attempt === this.config.retryAttempts) {
                    throw error;
                }
                // Wait before retry
                await this.delay(this.config.retryDelay * (attempt + 1));
            }
        }
        throw lastError;
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // === AUTH METHODS ===
    async login(email, password) {
        const response = await this.requestWithRetry({
            method: 'POST',
            url: '/api/auth/login',
            data: { email, password },
        });
        if (response.token) {
            this.setAuthToken(response.token);
        }
        return response;
    }
    async logout() {
        try {
            await this.request({
                method: 'POST',
                url: '/api/auth/logout',
            });
        }
        finally {
            this.clearAuthToken();
        }
    }
    async getCurrentUser() {
        return this.requestWithRetry({
            method: 'GET',
            url: '/api/auth/me',
        });
    }
    async refreshToken() {
        const response = await this.requestWithRetry({
            method: 'POST',
            url: '/api/auth/refresh',
        });
        if (response.token) {
            this.setAuthToken(response.token);
        }
        return response;
    }
    // === ORDER METHODS ===
    async createOrder(orderData) {
        return this.requestWithRetry({
            method: 'POST',
            url: '/api/orders',
            data: orderData,
        });
    }
    async getOrder(orderId) {
        return this.requestWithRetry({
            method: 'GET',
            url: `/api/orders/${orderId}`,
        });
    }
    async getOrders(params) {
        return this.requestWithRetry({
            method: 'GET',
            url: '/api/orders',
            params,
        });
    }
    async updateOrder(orderId, updateData) {
        return this.requestWithRetry({
            method: 'PATCH',
            url: `/api/orders/${orderId}`,
            data: updateData,
        });
    }
    async cancelOrder(orderId, reason) {
        return this.requestWithRetry({
            method: 'POST',
            url: `/api/orders/${orderId}/cancel`,
            data: { reason },
        });
    }
    // === PAYMENT METHODS ===
    async createPayment(paymentData) {
        return this.requestWithRetry({
            method: 'POST',
            url: '/api/payments',
            data: paymentData,
        });
    }
    async getPayment(paymentId) {
        return this.requestWithRetry({
            method: 'GET',
            url: `/api/payments/${paymentId}`,
        });
    }
    async getPayments(params) {
        return this.requestWithRetry({
            method: 'GET',
            url: '/api/payments',
            params,
        });
    }
    async updatePaymentStatus(paymentId, status) {
        return this.requestWithRetry({
            method: 'PATCH',
            url: `/api/payments/${paymentId}/status`,
            data: { status },
        });
    }
    // === HEALTH CHECK ===
    async healthCheck() {
        return this.request({
            method: 'GET',
            url: '/api/health',
        });
    }
    // === CONFIGURATION ===
    updateConfig(newConfig) {
        this.config = types_1.SdkConfigSchema.parse({ ...this.config, ...newConfig });
        // Update axios instance
        this.client.defaults.baseURL = this.config.baseURL;
        this.client.defaults.timeout = this.config.timeout;
    }
    getConfig() {
        return { ...this.config };
    }
}
exports.OrderManagementSDK = OrderManagementSDK;
//# sourceMappingURL=client-complex.js.map