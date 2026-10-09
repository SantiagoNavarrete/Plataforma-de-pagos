import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";

export const RESERVATION_DURATION_MS = 10 * 60 * 1000;
export const MAX_TICKETS_PER_PERSON = 8;
export const SERVICE_FEE_BASIS_POINTS = 0;
export const IVA_BASIS_POINTS = 1600;

type ReservationTransaction = Prisma.TransactionClient;
type ReservedItem = {
  eventId: string;
  ticketZoneId: string;
  quantity: number;
};

export class InventoryUnavailableError extends Error {
  constructor() {
    super("La disponibilidad cambió. Elige otra zona o cantidad.");
    this.name = "InventoryUnavailableError";
  }
}

export class TicketLimitExceededError extends Error {
  constructor() {
    super(`El límite es de ${MAX_TICKETS_PER_PERSON} boletos por evento y correo.`);
    this.name = "TicketLimitExceededError";
  }
}

async function releaseInventory(
  tx: ReservationTransaction,
  guestEmail: string,
  items: ReservedItem[],
) {
  const sortedItems = [...items].sort((left, right) =>
    left.ticketZoneId.localeCompare(right.ticketZoneId),
  );

  for (const item of sortedItems) {
    const buyerLimit = await tx.eventBuyerLimit.updateMany({
      where: {
        eventId: item.eventId,
        email: guestEmail,
        ticketsReserved: { gte: item.quantity },
      },
      data: { ticketsReserved: { decrement: item.quantity } },
    });

    if (buyerLimit.count !== 1) {
      throw new Error("La reserva excede el límite retenido para este correo.");
    }

    const result = await tx.ticketZone.updateMany({
      where: {
        id: item.ticketZoneId,
        inventoryReserved: { gte: item.quantity },
      },
      data: { inventoryReserved: { decrement: item.quantity } },
    });

    if (result.count !== 1) {
      throw new Error("La reserva excede el inventario retenido para la zona.");
    }
  }
}

export async function releaseExpiredReservations(
  tx: ReservationTransaction,
  now = new Date(),
) {
  const expiredOrders = await tx.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_PENDING] },
      reservationEndsAt: { lte: now },
    },
    select: {
      id: true,
      guestEmail: true,
      items: {
        select: {
          eventId: true,
          ticketZoneId: true,
          quantity: true,
        },
      },
    },
    orderBy: { reservationEndsAt: "asc" },
    take: 250,
  });

  for (const order of expiredOrders) {
    const changed = await tx.order.updateMany({
      where: {
        id: order.id,
        status: { in: [OrderStatus.PENDING, OrderStatus.PAYMENT_PENDING] },
        reservationEndsAt: { lte: now },
      },
      data: { status: OrderStatus.EXPIRED },
    });

    if (changed.count === 1) {
      await tx.payment.updateMany({
        where: {
          orderId: order.id,
          status: {
            in: [
              PaymentStatus.PENDING,
              PaymentStatus.PROCESSING,
              PaymentStatus.AUTHORIZED,
            ],
          },
        },
        data: { status: PaymentStatus.EXPIRED },
      });
      await releaseInventory(tx, order.guestEmail, order.items);
    }
  }
}

export async function cancelPendingReservation(
  tx: ReservationTransaction,
  orderNumber: string,
) {
  const order = await tx.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      status: true,
      guestEmail: true,
      items: {
        select: {
          eventId: true,
          ticketZoneId: true,
          quantity: true,
        },
      },
    },
  });

  if (!order) return "NOT_FOUND" as const;
  if (order.status !== OrderStatus.PENDING) return "NOT_PENDING" as const;

  const changed = await tx.order.updateMany({
    where: {
      id: order.id,
      status: OrderStatus.PENDING,
    },
    data: { status: OrderStatus.CANCELLED },
  });

  if (changed.count !== 1) return "NOT_PENDING" as const;

  await releaseInventory(tx, order.guestEmail, order.items);
  return "CANCELLED" as const;
}
