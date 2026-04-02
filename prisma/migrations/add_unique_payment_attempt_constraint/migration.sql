-- AlterTable
CREATE UNIQUE INDEX "payment_attempts_order_id_status_unique" ON "payment_attempts"("order_id", "status");
