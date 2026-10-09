import { timingSafeEqual } from "node:crypto";
import { EventStatus, OrderStatus, TicketStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  hashTicketCode,
  verifyTicketCode,
} from "@/lib/tickets";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const validationSchema = z.object({
  code: z.string().min(1).max(200),
}).strict();

function hasValidStaffKey(request: Request) {
  const expected = process.env.TICKET_VALIDATION_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || Buffer.byteLength(expected) < 32 || !authorization) return false;

  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const configured = Buffer.from(expected);
  return (
    supplied.length === configured.length &&
    timingSafeEqual(configured, supplied)
  );
}

export async function POST(request: Request) {
  if (!hasValidStaffKey(request)) {
    const configuredSecret = process.env.TICKET_VALIDATION_SECRET;
    if (!configuredSecret || Buffer.byteLength(configuredSecret) < 32) {
      console.error("Falta configurar TICKET_VALIDATION_SECRET para validar boletos.");
      return NextResponse.json(
        { error: "La validación de boletos no está configurada." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Acceso de validación no autorizado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "La solicitud debe contener JSON válido." }, { status: 400 });
    }
    throw error;
  }

  const parsed = validationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "El código QR no es válido." }, { status: 400 });
  }

  const ticketId = verifyTicketCode(parsed.data.code);
  if (!ticketId) {
    return NextResponse.json({ error: "El código QR no es válido." }, { status: 400 });
  }

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      tokenHash: hashTicketCode(parsed.data.code),
    },
    select: {
      id: true,
      status: true,
      checkedInAt: true,
      orderId: true,
      order: { select: { orderNumber: true, status: true } },
      ticketZone: { select: { name: true } },
      orderItem: {
        select: {
          event: {
            select: {
              title: true,
              startsAt: true,
              timeZone: true,
              status: true,
              venue: { select: { name: true, city: true } },
            },
          },
        },
      },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "No encontramos un boleto con ese código." }, { status: 404 });
  }
  if (ticket.status === TicketStatus.USED) {
    return NextResponse.json(
      {
        error: "Este boleto ya fue utilizado.",
        checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
      },
      { status: 409 },
    );
  }
  if (
    ticket.status !== TicketStatus.VALID ||
    (ticket.order.status !== OrderStatus.CONFIRMED &&
      ticket.order.status !== OrderStatus.PARTIALLY_REFUNDED) ||
    ticket.orderItem.event.status === EventStatus.CANCELLED
  ) {
    return NextResponse.json(
      { error: "Este boleto no está activo para ingresar al evento." },
      { status: 409 },
    );
  }

  const checkedInAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: {
        id: ticket.id,
        status: TicketStatus.VALID,
        tokenHash: hashTicketCode(parsed.data.code),
      },
      data: {
        status: TicketStatus.USED,
        checkedInAt,
      },
    });

    if (updated.count !== 1) return false;

    await tx.auditLog.create({
      data: {
        orderId: ticket.orderId,
        action: "TICKET_CHECKED_IN",
        entityType: "Ticket",
        entityId: ticket.id,
      },
    });
    return true;
  });

  if (!result) {
    return NextResponse.json(
      { error: "Este boleto ya fue utilizado por otro acceso." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    status: "VALIDATED",
    checkedInAt: checkedInAt.toISOString(),
    ticket: {
      event: ticket.orderItem.event.title,
      startsAt: ticket.orderItem.event.startsAt.toISOString(),
      timeZone: ticket.orderItem.event.timeZone,
      venue: ticket.orderItem.event.venue.name,
      city: ticket.orderItem.event.venue.city,
      zone: ticket.ticketZone.name,
      orderNumber: ticket.order.orderNumber,
    },
  });
}
