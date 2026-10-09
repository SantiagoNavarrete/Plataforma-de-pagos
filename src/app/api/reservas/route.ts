import { randomBytes } from "node:crypto";
import {
  EventStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticationConfigured } from "@/lib/auth-config";
import {
  InventoryUnavailableError,
  IVA_BASIS_POINTS,
  MAX_TICKETS_PER_PERSON,
  RESERVATION_DURATION_MS,
  SERVICE_FEE_BASIS_POINTS,
  TicketLimitExceededError,
  releaseExpiredReservations,
} from "@/lib/reservations";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const reservationSchema = z.object({
  eventSlug: z
    .string({ error: "Indica el evento que quieres reservar." })
    .trim()
    .min(1, "Indica el evento que quieres reservar.")
    .max(180, "El evento indicado no es válido."),
  email: z
    .string({ error: "Escribe un correo electrónico válido." })
    .trim()
    .email("Escribe un correo electrónico válido.")
    .max(320, "El correo electrónico es demasiado largo.")
    .transform((value) => value.toLowerCase()),
  items: z
    .array(
      z.object({
        ticketZoneId: z
          .string({ error: "Elige una zona de boletos válida." })
          .uuid("Elige una zona de boletos válida."),
        quantity: z
          .number({ error: "Indica una cantidad de boletos válida." })
          .int("La cantidad de boletos debe ser un número entero.")
          .min(1, "Reserva al menos un boleto.")
          .max(MAX_TICKETS_PER_PERSON, `El límite es de ${MAX_TICKETS_PER_PERSON} boletos por pedido.`),
      }),
      { error: "Selecciona al menos una zona de boletos." },
    )
    .min(1, "Selecciona al menos una zona de boletos.")
    .max(MAX_TICKETS_PER_PERSON, `El límite es de ${MAX_TICKETS_PER_PERSON} boletos por pedido.`)
    .refine(
      (items) => new Set(items.map((item) => item.ticketZoneId)).size === items.length,
      "No repitas la misma zona.",
    )
    .refine(
      (items) =>
        items.reduce((total, item) => total + item.quantity, 0) <=
        MAX_TICKETS_PER_PERSON,
      `El límite es de ${MAX_TICKETS_PER_PERSON} boletos por pedido.`,
    ),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "El cuerpo de la solicitud no es JSON válido." }, { status: 400 });
    }
    throw error;
  }

  const parsed = reservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos de la reserva." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const session = isAuthenticationConfigured()
    ? await (await import("@/lib/auth")).auth.api.getSession({
        headers: request.headers,
      })
    : null;
  const sessionEmail = session?.user.email.toLowerCase();
  if (sessionEmail && sessionEmail !== input.email) {
    return NextResponse.json(
      { error: "Usa el correo de tu cuenta para asociar la compra." },
      { status: 400 },
    );
  }
  const quantity = input.items.reduce((total, item) => total + item.quantity, 0);
  const orderNumber = `BO-${randomBytes(14).toString("hex").toUpperCase()}`;
  const reservationEndsAt = new Date(Date.now() + RESERVATION_DURATION_MS);

  try {
    const order = await prisma.$transaction(async (tx) => {
      await releaseExpiredReservations(tx);

      const event = await tx.event.findUnique({
        where: { slug: input.eventSlug },
        select: { id: true, status: true, startsAt: true },
      });
      if (!event) throw new InventoryUnavailableError();
      if (
        event.status !== EventStatus.PUBLISHED ||
        event.startsAt <= new Date()
      ) {
        throw new InventoryUnavailableError();
      }

      await tx.eventBuyerLimit.upsert({
        where: {
          eventId_email: { eventId: event.id, email: input.email },
        },
        create: { eventId: event.id, email: input.email },
        update: {},
      });

      const buyerLimit = await tx.$queryRaw<Array<{ eventId: string }>>(
        Prisma.sql`
          UPDATE "EventBuyerLimit"
          SET "ticketsReserved" = "ticketsReserved" + ${quantity},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "eventId" = ${event.id}::uuid
            AND "email" = ${input.email}
            AND "ticketsReserved" + "ticketsSold" + ${quantity} <= ${MAX_TICKETS_PER_PERSON}
          RETURNING "eventId"::text AS "eventId"
        `,
      );

      if (buyerLimit.length !== 1) {
        throw new TicketLimitExceededError();
      }

      const sortedItems = [...input.items].sort((left, right) =>
        left.ticketZoneId.localeCompare(right.ticketZoneId),
      );
      for (const item of sortedItems) {
        const reserved = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            UPDATE "TicketZone"
            SET "inventoryReserved" = "inventoryReserved" + ${item.quantity},
                "updatedAt" = CURRENT_TIMESTAMP
            FROM "Event"
            WHERE "TicketZone"."id" = ${item.ticketZoneId}::uuid
              AND "TicketZone"."eventId" = "Event"."id"
              AND "Event"."id" = ${event.id}::uuid
              AND "Event"."status" = 'PUBLISHED'
              AND "Event"."startsAt" > CURRENT_TIMESTAMP
              AND "TicketZone"."inventoryTotal" - "TicketZone"."inventoryReserved" - "TicketZone"."inventorySold" >= ${item.quantity}
            RETURNING "TicketZone"."id"::text AS id
          `,
        );

        if (reserved.length !== 1) throw new InventoryUnavailableError();
      }

      const zones = await tx.ticketZone.findMany({
        where: {
          id: { in: input.items.map((item) => item.ticketZoneId) },
          eventId: event.id,
        },
        select: {
          id: true,
          name: true,
          priceCents: true,
        },
      });
      if (zones.length !== input.items.length) {
        throw new InventoryUnavailableError();
      }

      const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
      const orderItems = input.items.map((item) => {
        const zone = zoneById.get(item.ticketZoneId);
        if (!zone) throw new InventoryUnavailableError();
        const subtotalCents = zone.priceCents * item.quantity;
        const taxCents = Math.round(
          (subtotalCents * IVA_BASIS_POINTS) / 10_000,
        );
        const serviceFeeCents = Math.round(
          (subtotalCents * SERVICE_FEE_BASIS_POINTS) / 10_000,
        );

        return {
          eventId: event.id,
          ticketZoneId: zone.id,
          quantity: item.quantity,
          unitPriceCents: zone.priceCents,
          taxCents,
          serviceFeeCents,
          subtotalCents,
        };
      });

      const subtotalCents = orderItems.reduce(
        (total, item) => total + item.subtotalCents,
        0,
      );
      const taxCents = orderItems.reduce((total, item) => total + item.taxCents, 0);
      const serviceFeeCents = orderItems.reduce(
        (total, item) => total + item.serviceFeeCents,
        0,
      );

      return tx.order.create({
        data: {
          orderNumber,
          guestEmail: input.email,
          ...(session ? { userId: session.user.id } : {}),
          status: OrderStatus.PENDING,
          currency: "MXN",
          subtotalCents,
          serviceFeeCents,
          taxCents,
          totalCents: subtotalCents + serviceFeeCents + taxCents,
          reservationEndsAt,
          items: {
            create: orderItems.map((item) => ({
              eventId: item.eventId,
              ticketZoneId: item.ticketZoneId,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              taxCents: item.taxCents,
              serviceFeeCents: item.serviceFeeCents,
            })),
          },
        },
        select: {
          orderNumber: true,
          reservationEndsAt: true,
          subtotalCents: true,
          serviceFeeCents: true,
          taxCents: true,
          totalCents: true,
        },
      });
    });

    return NextResponse.json(
      {
        orderNumber: order.orderNumber,
        reservationEndsAt: order.reservationEndsAt,
        subtotalCents: order.subtotalCents,
        serviceFeeCents: order.serviceFeeCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        currency: "MXN",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InventoryUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof TicketLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
