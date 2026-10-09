import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import {
  priceToCents,
  ticketZoneCreateSchema,
} from "@/lib/admin-shared";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type EventZonesRouteProps = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: Request, { params }: EventZonesRouteProps) {
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

  const parsed = ticketZoneCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos de la zona." },
      { status: 400 },
    );
  }

  try {
    const zone = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { id: true },
      });
      if (!event) return null;

      const { priceMxn, ...zoneInput } = parsed.data;
      const created = await tx.ticketZone.create({
        data: {
          ...zoneInput,
          eventId: event.id,
          priceCents: priceToCents(priceMxn),
        },
        select: {
          id: true,
          name: true,
          priceCents: true,
          inventoryTotal: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: authorization.userId,
          action: "ADMIN_TICKET_ZONE_CREATED",
          entityType: "TicketZone",
          entityId: created.id,
          details: {
            eventId,
            name: created.name,
            priceCents: created.priceCents,
            inventoryTotal: created.inventoryTotal,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return created;
    });
    if (!zone) {
      return NextResponse.json({ error: "No encontramos ese evento." }, { status: 404 });
    }
    return NextResponse.json({ zone }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ya existe una zona con ese nombre para el evento." }, { status: 409 });
    }
    throw error;
  }
}
