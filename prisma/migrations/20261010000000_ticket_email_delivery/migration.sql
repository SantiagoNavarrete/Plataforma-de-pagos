CREATE TYPE "TicketEmailStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

ALTER TABLE "Ticket"
ADD COLUMN "sequence" INTEGER;

WITH numbered_tickets AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "orderItemId"
            ORDER BY "issuedAt", "id"
        )::INTEGER AS sequence
    FROM "Ticket"
)
UPDATE "Ticket"
SET "sequence" = numbered_tickets.sequence
FROM numbered_tickets
WHERE "Ticket"."id" = numbered_tickets."id";

ALTER TABLE "Ticket"
ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX "Ticket_orderItemId_sequence_key"
ON "Ticket"("orderItemId", "sequence");

CREATE TABLE "TicketEmailDelivery" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "TicketEmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TicketEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketEmailDelivery_orderId_key"
ON "TicketEmailDelivery"("orderId");

CREATE INDEX "TicketEmailDelivery_status_updatedAt_idx"
ON "TicketEmailDelivery"("status", "updatedAt");

ALTER TABLE "TicketEmailDelivery"
ADD CONSTRAINT "TicketEmailDelivery_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
