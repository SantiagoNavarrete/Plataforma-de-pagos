import { OrderStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  cancelPendingReservation,
  releaseExpiredReservations,
} from "@/lib/reservations";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ReservationRouteProps = {
  params: Promise<{ orderNumber: string }>;
};

export async function GET(_request: Request, { params }: ReservationRouteProps) {
  const { orderNumber } = await params;

  const reservation = await prisma.$transaction(async (tx) => {
    await releaseExpiredReservations(tx);
    return tx.order.findUnique({
      where: { orderNumber },
      select: {
        orderNumber: true,
        status: true,
        currency: true,
        subtotalCents: true,
        serviceFeeCents: true,
        taxCents: true,
        totalCents: true,
        reservationEndsAt: true,
        items: {
          select: {
            quantity: true,
            unitPriceCents: true,
            event: { select: { title: true, startsAt: true, timeZone: true } },
            ticketZone: { select: { name: true } },
          },
        },
      },
    });
  });

  if (!reservation) {
    return NextResponse.json({ error: "No encontramos esa reserva." }, { status: 404 });
  }

  return NextResponse.json(reservation);
}

export async function DELETE(
  _request: Request,
  { params }: ReservationRouteProps,
) {
  const { orderNumber } = await params;

  const result = await prisma.$transaction(async (tx) => {
    await releaseExpiredReservations(tx);
    return cancelPendingReservation(tx, orderNumber);
  });

  if (result === "NOT_FOUND") {
    return NextResponse.json({ error: "No encontramos esa reserva." }, { status: 404 });
  }

  if (result === "NOT_PENDING") {
    return NextResponse.json(
      { error: "Esta reserva ya no se puede cancelar desde aquí." },
      { status: 409 },
    );
  }

  return NextResponse.json({ status: OrderStatus.CANCELLED });
}
