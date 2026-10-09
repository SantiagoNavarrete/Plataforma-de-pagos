import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import {
  priceToCents,
  ticketZoneUpdateSchema,
} from "@/lib/admin-shared";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type TicketZoneRouteProps = {
  params: Promise<{ zoneId: string }>;
};

class InventoryChangedError extends Error {}
class InvalidInventoryError extends Error {}

export async function PATCH(request: Request, { params }: TicketZoneRouteProps) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  const { zoneId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(zoneId)) {
    return NextResponse.json({ error: "La zona indicada no es válida." }, { status: 400 });
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

  const parsed = ticketZoneUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos de la zona." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  try {
    const zone = await prisma.$transaction(async (tx) => {
      const current = await tx.ticketZone.findUnique({
        where: { id: zoneId },
        select: {
          id: true,
          eventId: true,
          name: true,
          priceCents: true,
          inventoryTotal: true,
          inventoryReserved: true,
          inventorySold: true,
          isReservedSeating: true,
        },
      });
      if (!current) return null;

      const inventoryTotal = input.inventoryTotal ?? current.inventoryTotal;
      if (inventoryTotal < current.inventoryReserved + current.inventorySold) {
        throw new InvalidInventoryError();
      }

      const updated = await tx.ticketZone.updateMany({
        where: {
          id: zoneId,
          inventoryTotal: current.inventoryTotal,
          inventoryReserved: current.inventoryReserved,
          inventorySold: current.inventorySold,
        },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.priceMxn === undefined
            ? {}
            : { priceCents: priceToCents(input.priceMxn) }),
          inventoryTotal,
          ...(input.isReservedSeating === undefined
            ? {}
            : { isReservedSeating: input.isReservedSeating }),
        },
      });
      if (updated.count !== 1) throw new InventoryChangedError();

      const saved = await tx.ticketZone.findUniqueOrThrow({
        where: { id: zoneId },
        select: {
          id: true,
          name: true,
          priceCents: true,
          inventoryTotal: true,
          inventoryReserved: true,
          inventorySold: true,
          isReservedSeating: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: authorization.userId,
          action: "ADMIN_TICKET_ZONE_UPDATED",
          entityType: "TicketZone",
          entityId: saved.id,
          details: {
            eventId: current.eventId,
            changes: Object.keys(input),
            inventoryTotal: saved.inventoryTotal,
            inventoryReserved: saved.inventoryReserved,
            inventorySold: saved.inventorySold,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return saved;
    });
    if (!zone) {
      return NextResponse.json({ error: "No encontramos esa zona." }, { status: 404 });
    }
    return NextResponse.json({ zone });
  } catch (error) {
    if (error instanceof InvalidInventoryError) {
      return NextResponse.json(
        { error: "El inventario total no puede ser menor que los boletos vendidos y reservados." },
        { status: 409 },
      );
    }
    if (error instanceof InventoryChangedError) {
      return NextResponse.json(
        { error: "El inventario cambió mientras guardábamos. Actualiza la vista e intenta de nuevo." },
        { status: 409 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ya existe una zona con ese nombre para el evento." }, { status: 409 });
    }
    throw error;
  }
}
