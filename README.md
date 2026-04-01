# Order Management Backend

A backend for TikTok/Instagram seller order management system built with Next.js App Router, Prisma, and SQLite. **This is a development template - additional security and production hardening required for production use.**

## Features

- **Public API**: Product listing and order creation
- **Seller Dashboard**: Order management, product management
- **Authentication**: JWT-based auth for sellers
- **Order Lifecycle**: Strict status transitions with audit trail
- **Notifications**: Queue-based notification system
- **Payment Processing**: Stripe webhook integration (idempotent)
- **Rate Limiting**: Protection against abuse
- **Structured Logging**: Request tracing and audit logs

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Database**: SQLite with Prisma ORM
- **Validation**: Zod schemas
- **Authentication**: JWT tokens
- **Language**: TypeScript

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Seed database with demo data
npm run seed

# Start development server
npm run dev
```

### Environment Variables

Create a `.env` file with:

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
NEXTAUTH_SECRET="your-nextauth-secret-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
```

### Demo Credentials

After seeding, use these credentials to test:

- **Email**: demo@seller.com
- **Password**: demo123
- **Seller Slug**: demo-store

## API Endpoints

### Public Endpoints

- `GET /api/public/{sellerSlug}/products` - List active products
- `POST /api/public/{sellerSlug}/orders` - Create new order

### Authentication

- `POST /api/auth/login` - Login and get JWT token
- `DELETE /api/auth/login` - Logout
- `GET /api/me` - Get current user info

### Seller Endpoints (Requires Authentication)

- `GET /api/seller/orders` - List orders with pagination
- `GET /api/seller/orders/{id}` - Get order details
- `PATCH /api/seller/orders/{id}/status` - Update order status
- `GET /api/seller/products` - List products
- `POST /api/seller/products` - Create product
- `PATCH /api/seller/products/{id}` - Update product
- `DELETE /api/seller/products/{id}` - Delete product

### Webhooks

- `POST /api/webhooks/stripe` - Stripe payment webhooks
- `POST /api/webhooks/whatsapp` - WhatsApp webhooks

## Order Status Transitions

Allowed transitions:

- `PENDING` → `CONFIRMED` | `CANCELLED`
- `CONFIRMED` → `PACKED` | `CANCELLED`
- `PACKED` → `OUT_FOR_DELIVERY`
- `OUT_FOR_DELIVERY` → `DELIVERED`
- `DELIVERED` (terminal)
- `CANCELLED` (terminal)

## Database Schema

The system uses these core entities:

- **Users** - Authentication and roles
- **Sellers** - Store information and branding
- **Products** - Product catalog
- **Customers** - Customer information
- **Orders** - Order management
- **OrderItems** - Order line items
- **OrderEvents** - Audit trail
- **NotificationJobs** - Notification queue
- **PaymentAttempts** - Payment tracking
- **WebhookEvents** - Webhook deduplication

## Development

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run tests
npm run seed         # Seed database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
```

### Project Structure

```
src/
├── app/
│   └── api/
│       ├── auth/
│       ├── me/
│       ├── public/
│       │   └── [sellerSlug]/
│       ├── seller/
│       │   ├── orders/
│       │   └── products/
│       └── webhooks/
└── server/
    ├── db/
    │   └── prisma.ts
    ├── lib/
    │   ├── auth.ts
    │   ├── errors.ts
    │   ├── logger.ts
    │   ├── rate-limit.ts
    │   ├── utils.ts
    │   └── validation.ts
    └── modules/
        ├── auth/
        ├── orders/
        ├── notifications/
        └── payments/
```

## Security Features

- **JWT Authentication**: Secure token-based auth
- **Rate Limiting**: Prevent abuse on public endpoints
- **Input Validation**: Zod schema validation
- **Tenant Isolation**: Sellers can only access their own data
- **Webhook Verification**: Signature verification for webhooks
- **Audit Trail**: Complete order event history
- **Idempotency**: Safe retry handling for payments/webhooks

## Production Readiness

### ✅ Implemented

- JWT-based authentication with secure password hashing
- Order status transition enforcement
- Database constraints and indexes
- Audit trail for order changes
- Input validation with Zod schemas
- Webhook deduplication

### ⚠️ Production Hardening Required

- **Database**: Replace SQLite with PostgreSQL for production
- **Environment Variables**: Ensure all secrets are properly configured
- **Rate Limiting**: Implement more sophisticated rate limiting
- **Monitoring**: Add application performance monitoring
- **Logging**: Enhanced structured logging for production
- **Error Handling**: Global error handling and reporting
- **Security**: Add CSRF protection, security headers
- **Testing**: Comprehensive test suite before production
- **CI/CD**: Automated testing and deployment pipelines

## Production Deployment

### Environment Setup

1. Set production environment variables
2. Use a production database (PostgreSQL recommended)
3. Configure proper JWT secrets
4. Set up webhook endpoints with proper authentication
5. Configure monitoring and logging

### Database Migration

```bash
# Generate migration for production
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### Health Checks

- `GET /api/health` - Basic health check (add if needed)

## Testing

The system includes comprehensive test coverage:

- Unit tests for business logic
- Integration tests for API endpoints
- Security tests for tenant isolation
- Idempotency tests for webhooks

Run tests with:

```bash
npm run test
```

## Monitoring

Structured logging includes:

- Request IDs for tracing
- User context in logs
- Order and payment events
- Error tracking

## Contributing

1. Follow the existing code patterns
2. Add tests for new features
3. Update documentation
4. Ensure all security measures are in place

## License

MIT License - see LICENSE file for details
