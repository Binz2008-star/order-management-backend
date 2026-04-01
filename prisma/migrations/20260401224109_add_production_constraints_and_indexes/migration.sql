-- CreateIndex
CREATE INDEX "customers_seller_id_name_idx" ON "customers"("seller_id", "name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "notification_jobs_seller_id_status_idx" ON "notification_jobs"("seller_id", "status");

-- CreateIndex
CREATE INDEX "notification_jobs_channel_status_idx" ON "notification_jobs"("channel", "status");

-- CreateIndex
CREATE INDEX "notification_jobs_retry_count_idx" ON "notification_jobs"("retry_count");

-- CreateIndex
CREATE INDEX "order_events_event_type_idx" ON "order_events"("event_type");

-- CreateIndex
CREATE INDEX "order_events_actor_user_id_idx" ON "order_events"("actor_user_id");

-- CreateIndex
CREATE INDEX "order_events_created_at_idx" ON "order_events"("created_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_product_id_idx" ON "order_items"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "orders_seller_id_customer_id_idx" ON "orders"("seller_id", "customer_id");

-- CreateIndex
CREATE INDEX "orders_public_order_number_idx" ON "orders"("public_order_number");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "products_seller_id_created_at_idx" ON "products"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "products_seller_id_name_idx" ON "products"("seller_id", "name");

-- CreateIndex
CREATE INDEX "products_is_active_idx" ON "products"("is_active");

-- CreateIndex
CREATE INDEX "sellers_owner_user_id_idx" ON "sellers"("owner_user_id");

-- CreateIndex
CREATE INDEX "sellers_status_idx" ON "sellers"("status");

-- CreateIndex
CREATE INDEX "sellers_slug_idx" ON "sellers"("slug");

-- CreateIndex
CREATE INDEX "sellers_created_at_idx" ON "sellers"("created_at");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");
