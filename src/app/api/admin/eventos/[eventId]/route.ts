import { EventStatus, Prisma, TicketStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { eventUpdateSchema } from "@/lib/admin-shared";
import { requireAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type EventRouteProps = {
  params: Promise<{ eventId: string }>;
};

export async function PATCH(request: Request, { params }: EventRouteProps) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  const { eventId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json({ error: "El evento indicado no es válido." }, { status: 400 });
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

  const parsed = eventUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos del evento." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          timeZone: true,
          venueId: true,
        },
      });
      if (!current) return null;
      if (
        current.status === EventStatus.CANCELLED &&
        input.status !== undefined &&
        input.status !== EventStatus.CANCELLED
      ) {
        throw new RangeError("Un evento cancelado no se puede reactivar; crea una nueva fecha.");
      }

      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt =
        input.endsAt === undefined
          ? current.endsAt
          : input.endsAt === null
            ? null
            : new Date(input.endsAt);
      const status = input.status ?? current.status;
      if (endsAt && endsAt <= startsAt) {
        throw new RangeError("La fecha de término debe ser posterior al inicio.");
      }
      if (status === EventStatus.PUBLISHED && startsAt <= new Date()) {
        throw new RangeError("Un evento publicado debe tener una fecha futura.");
      }

      let venueId = current.venueId;
      let timeZone = current.timeZone;
      if (input.venueId) {
        const venue = await tx.venue.findUnique({
          where: { id: input.venueId },
          select: { id: true, timeZone: true },
        });
        if (!venue) throw new RangeError("Selecciona un recinto existente.");
        venueId = venue.id;
        timeZone = venue.timeZone;
      }

      const event = await tx.event.update({
        where: { id: eventId },
        data: {
          ...input,
          startsAt,
          endsAt,
          venueId,
          timeZone,
        },
        select: { id: true, slug: true, title: true, status: true },
      });
      if (event.status === EventStatus.CANCELLED) {
        await tx.ticket.updateMany({
          where: {
            status: TicketStatus.VALID,
            ticketZone: { is: { eventId: event.id } },
          },
          data: { status: TicketStatus.CANCELLED },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: authorization.userId,
          action: "ADMIN_EVENT_UPDATED",
          entityType: "Event",
          entityId: event.id,
          details: {
            changes: Object.keys(input),
            status: event.status,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return event;
    });

    if (!updated) {
      return NextResponse.json({ error: "No encontramos ese evento." }, { status: 404 });
    }
    return NextResponse.json({ event: updated });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
