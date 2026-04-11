/**
 * Platform Integration Layer
 *
 * This module provides the runtime with access to platform services
 * while maintaining strict domain boundaries.
 */

export interface PlatformProduct {
  id: string;
  name: string;
  priceMinor: number;
  sellerId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface PlatformService {
  /**
   * Validate product IDs against platform catalog
   * Returns product details for valid products
   */
  validateProducts(productIds: string[]): Promise<Map<string, PlatformProduct>>;

  /**
   * Check if a product belongs to a seller
   */
  verifyProductOwnership(productId: string, sellerId: string): Promise<boolean>;

  /**
   * Get product pricing for order calculation
   */
  getProductPricing(productId: string): Promise<number>;
}

interface PlatformValidationResponse {
  products: Array<{
    id: string;
    name: string;
    priceMinor: number;
    sellerId: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }>;
}

interface PlatformOwnershipResponse {
  owned: boolean;
  sellerId: string;
}

interface PlatformPricingResponse {
  priceMinor: number;
}

/**
 * Platform client implementation
 * In production, this would make HTTP calls to the platform API
 */
export class PlatformClient implements PlatformService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.PLATFORM_API_URL || 'http://localhost:3001';
    this.apiKey = process.env.PLATFORM_API_KEY || 'dev-key';
  }

  async validateProducts(productIds: string[]): Promise<Map<string, PlatformProduct>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/platform/products/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ productIds })
      });

      if (!response.ok) {
        throw new Error(`Platform API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PlatformValidationResponse;
      const productMap = new Map<string, PlatformProduct>();

      if (data.products && Array.isArray(data.products)) {
        data.products.forEach((product) => {
          productMap.set(product.id, {
            id: product.id,
            name: product.name,
            priceMinor: product.priceMinor,
            sellerId: product.sellerId,
            status: product.status || 'ACTIVE'
          });
        });
      }

      return productMap;
    } catch (error) {
      console.error('Platform validation error:', error);
      // Fail safe - return empty map to indicate validation failure
      throw new Error(`Platform validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async verifyProductOwnership(productId: string, sellerId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/platform/products/${productId}/ownership`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Platform API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PlatformOwnershipResponse;
      return data.owned === true && data.sellerId === sellerId;
    } catch (error) {
      console.error('Platform ownership verification error:', error);
      // Fail safe - return false to require explicit validation
      return false;
    }
  }

  async getProductPricing(productId: string): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}/api/platform/products/${productId}/pricing`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`Platform API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PlatformPricingResponse;
      return data.priceMinor || 0;
    } catch (error) {
      console.error('Platform pricing error:', error);
      throw new Error(`Failed to get product pricing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
export const platformClient = new PlatformClient();
