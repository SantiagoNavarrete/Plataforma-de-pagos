import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

export function getTicketSecret() {
  const secret = process.env.TICKET_QR_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("TICKET_QR_SECRET debe contener al menos 32 bytes.");
  }
  return secret;
}

export function createTicketCode(ticketId: string, secret = getTicketSecret()) {
  const signature = createHmac("sha256", secret)
    .update(`ticket:${ticketId}`)
    .digest("hex");
  return `${ticketId}.${signature}`;
}

export function hashTicketCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function verifyTicketCode(code: string, secret = getTicketSecret()) {
  const [ticketId, signature, ...extra] = code.split(".");
  if (
    extra.length !== 0 ||
    !ticketId ||
    !UUID_PATTERN.test(ticketId) ||
    !signature ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return null;
  }

  const expected = createHmac("sha256", secret)
    .update(`ticket:${ticketId}`)
    .digest();
  const actual = Buffer.from(signature, "hex");
  return timingSafeEqual(expected, actual) ? ticketId : null;
}

export function createOrderAccessToken(orderId: string, secret = getTicketSecret()) {
  return createHmac("sha256", secret)
    .update(`order-access:${orderId}`)
    .digest("base64url");
}

export function verifyOrderAccessToken(
  orderId: string,
  token: string,
  secret = getTicketSecret(),
) {
  if (token.length > 100) return false;
  const expected = Buffer.from(createOrderAccessToken(orderId, secret));
  const actual = Buffer.from(token);
  return (
    actual.length === expected.length && timingSafeEqual(expected, actual)
  );
}

export async function issueTicketsForConfirmedOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const secret = getTicketSecret();
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      quantity: true,
      ticketZoneId: true,
      tickets: { select: { sequence: true } },
    },
  });

  const ticketsToCreate: Prisma.TicketCreateManyInput[] = [];
  for (const item of items) {
    const issuedSequences = new Set(item.tickets.map((ticket) => ticket.sequence));
    for (let sequence = 1; sequence <= item.quantity; sequence += 1) {
      if (issuedSequences.has(sequence)) continue;

      const id = randomUUID();
      const tokenHash = hashTicketCode(createTicketCode(id, secret));
      ticketsToCreate.push({
        id,
        orderId,
        orderItemId: item.id,
        ticketZoneId: item.ticketZoneId,
        sequence,
        tokenHash,
      });
    }
  }

  if (ticketsToCreate.length > 0) {
    await tx.ticket.createMany({ data: ticketsToCreate, skipDuplicates: true });
  }

  await tx.ticketEmailDelivery.upsert({
    where: { orderId },
    create: { orderId },
    update: {},
  });
}
