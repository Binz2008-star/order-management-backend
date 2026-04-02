-- RedefineIndex
DROP INDEX "payment_attempts_order_id_status_unique";
CREATE UNIQUE INDEX "payment_attempts_order_id_status_key" ON "payment_attempts"("order_id", "status");
