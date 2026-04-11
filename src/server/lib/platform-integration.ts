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

  async validateProducts(_productIds: string[]): Promise<Map<string, PlatformProduct>> {
    // TODO: Implement actual platform API call
    // For now, return empty map to indicate platform dependency
    console.warn('Platform integration not implemented - product validation skipped');
    return new Map();
  }

  async verifyProductOwnership(_productId: string, _sellerId: string): Promise<boolean> {
    // TODO: Implement platform API call
    return false; // Fail safe - require explicit platform validation
  }

  async getProductPricing(_productId: string): Promise<number> {
    // TODO: Implement platform API call
    throw new Error('Product pricing must come from platform API');
  }
}

// Singleton instance
export const platformClient = new PlatformClient();
