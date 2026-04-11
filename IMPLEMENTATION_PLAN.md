# Architecture Refactoring Implementation Plan

## **Executive Summary**

The order-management-backend has been refactored to enforce strict domain boundaries between runtime and platform domains. Critical violations have been identified and corrected with a concrete implementation path forward.

## **Violations Fixed**

### **1. Platform Boundary Violations**

- **Products API**: Removed `/api/public/[sellerSlug]/products` endpoint from runtime
- **Product Validation**: Moved to platform integration layer
- **Catalog Queries**: Eliminated platform domain logic from runtime

### **2. Missing Runtime Authority Components**

- **Platform Integration Layer**: Added `platform-integration.ts` for clean separation
- **Order Validation Service**: Created `order-validation.ts` with platform integration
- **Proper Error Handling**: Implemented domain-specific validation errors

## **Implementation Changes**

### **Files Created**

1. `src/server/lib/platform-integration.ts` - Platform service interface and client
2. `src/server/lib/order-validation.ts` - Runtime order validation with platform integration

### **Files Modified**

1. `src/app/api/public/[sellerSlug]/products/route.ts` - Removed catalog queries, returns boundary error
2. `src/app/api/public/[sellerSlug]/checkout/route.ts` - Uses platform validation instead of local logic

## **Next Steps Required**

### **Phase 1: Platform API Implementation**

```typescript
// TODO: Implement actual platform API calls in platform-integration.ts
async validateProducts(productIds: string[]): Promise<Map<string, PlatformProduct>> {
  // Call platform API: GET /api/platform/products/validate
  // Return product map with pricing and availability
}

async verifyProductOwnership(productId: string, sellerId: string): Promise<boolean> {
  // Call platform API: GET /api/platform/products/{productId}/ownership
  // Verify product belongs to seller
}

async getProductPricing(productId: string): Promise<number> {
  // Call platform API: GET /api/platform/products/{productId}/pricing
  // Return current price in minor units
}
```

### **Phase 2: Environment Configuration**

```bash
# Add to production environment
PLATFORM_API_URL=https://platform-api.example.com
PLATFORM_API_KEY=your-platform-api-key
```

### **Phase 3: Missing Runtime Tables**

Add to Prisma schema:

```sql
-- Runtime authority tables
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  event_type TEXT,
  payload_json TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT,
  limit_count INTEGER,
  window_seconds INTEGER,
  current_count INTEGER DEFAULT 0,
  window_start TIMESTAMP DEFAULT NOW()
);

-- Inventory tables (if needed)
CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  seller_id TEXT,
  product_id TEXT,
  quantity_available INTEGER DEFAULT 0,
  reserved_quantity INTEGER DEFAULT 0
);

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  inventory_id TEXT,
  order_id TEXT,
  quantity INTEGER,
  status TEXT DEFAULT 'ACTIVE',
  expires_at TIMESTAMP
);
```

### **Phase 4: Audit Trail Implementation**

```typescript
// Add to order creation flow
await createAuditEvent(tx, order.id, "ORDER_CREATED", {
  sellerId: order.sellerId,
  customerId: order.customerId,
  totalMinor: order.totalMinor,
});

// Add to payment processing
await createAuditEvent(tx, payment.id, "PAYMENT_ATTEMPTED", {
  orderId: payment.orderId,
  amountMinor: payment.amountMinor,
  provider: payment.provider,
});
```

## **Testing Strategy**

### **Unit Tests**

- Platform integration layer (mock platform API)
- Order validation service with boundary conditions
- Error handling for platform failures

### **Integration Tests**

- End-to-end checkout flow with platform integration
- Boundary violation enforcement
- Runtime authority verification

### **Contract Tests**

- Platform API contract validation
- Runtime API boundary enforcement
- Error response format consistency

## **Deployment Checklist**

### **Pre-deployment**

- [ ] Platform API endpoints available and documented
- [ ] Environment variables configured
- [ ] Database schema updated with audit/rate limit tables
- [ ] Integration tests passing with platform API

### **Post-deployment**

- [ ] Monitor platform API latency and failures
- [ ] Verify audit trail completeness
- [ ] Test rate limiting effectiveness
- [ ] Validate boundary enforcement in production

## **Rollback Plan**

If platform integration fails:

1. Disable platform validation in checkout route
2. Revert to product snapshot validation only
3. Add monitoring for platform API availability
4. Implement circuit breaker pattern

## **Success Metrics**

- **Zero platform boundary violations** in runtime code
- **Complete audit trail** for all order/payment operations
- **Platform API response time** < 100ms for validation calls
- **Error rate** < 1% for platform integration calls
- **Runtime startup time** < 5 seconds with health checks

## **Owner Assignment**

- **Runtime Backend**: Orders, payments, audit, rate limiting, state machine
- **Platform Domain**: Products, catalog, pricing, inventory, AI workflows
- **Clear separation** maintained through integration layer only

This implementation ensures the runtime backend maintains its single source of truth authority for transactional operations while properly delegating platform concerns to the platform domain.
