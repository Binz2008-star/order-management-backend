/*
  Warnings:

  - Added the required column `password_hash` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_order_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_order_events" ("actor_user_id", "created_at", "event_type", "id", "order_id", "payload_json") SELECT "actor_user_id", "created_at", "event_type", "id", "order_id", "payload_json" FROM "order_events";
DROP TABLE "order_events";
ALTER TABLE "new_order_events" RENAME TO "order_events";
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");
CREATE TABLE "new_payment_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "raw_payload_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_payment_attempts" ("amount_minor", "created_at", "currency", "id", "order_id", "provider", "provider_reference", "raw_payload_json", "status", "updated_at") SELECT "amount_minor", "created_at", "currency", "id", "order_id", "provider", "provider_reference", "raw_payload_json", "status", "updated_at" FROM "payment_attempts";
DROP TABLE "payment_attempts";
ALTER TABLE "new_payment_attempts" RENAME TO "payment_attempts";
CREATE INDEX "payment_attempts_provider_provider_reference_idx" ON "payment_attempts"("provider", "provider_reference");
CREATE UNIQUE INDEX "payment_attempts_provider_provider_reference_key" ON "payment_attempts"("provider", "provider_reference");
CREATE TABLE "new_seller_staff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seller_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permissions_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_staff_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "seller_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_seller_staff" ("created_at", "id", "permissions_json", "seller_id", "user_id") SELECT "created_at", "id", "permissions_json", "seller_id", "user_id" FROM "seller_staff";
DROP TABLE "seller_staff";
ALTER TABLE "new_seller_staff" RENAME TO "seller_staff";
CREATE UNIQUE INDEX "seller_staff_seller_id_user_id_key" ON "seller_staff"("seller_id", "user_id");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_users" ("created_at", "email", "full_name", "id", "is_active", "phone", "role", "updated_at", "password_hash") SELECT "created_at", "email", "full_name", "id", "is_active", "phone", "role", "updated_at", '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukx.LFvO6' FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE TABLE "new_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "processed_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_webhook_events" ("created_at", "event_id", "event_type", "id", "payload_json", "processed_at", "provider", "status", "updated_at") SELECT "created_at", "event_id", "event_type", "id", "payload_json", "processed_at", "provider", "status", "updated_at" FROM "webhook_events";
DROP TABLE "webhook_events";
ALTER TABLE "new_webhook_events" RENAME TO "webhook_events";
CREATE INDEX "webhook_events_provider_event_id_idx" ON "webhook_events"("provider", "event_id");
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
