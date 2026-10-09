import {
  EventStatus,
  Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import {
  eventCreateSchema,
  priceToCents,
  slugify,
} from "@/lib/admin-shared";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  const events = await prisma.event.findMany({
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      artist: true,
      category: true,
      status: true,
      startsAt: true,
      endsAt: true,
      timeZone: true,
      venue: { select: { id: true, name: true, city: true, state: true } },
      ticketZones: {
        orderBy: { priceCents: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          inventoryTotal: true,
          inventoryReserved: true,
          inventorySold: true,
          isReservedSeating: true,
        },
      },
    },
  });

  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "La solicitud debe contener JSON válido." }, { status: 400 });
    }
    throw error;
  }

  const parsed = eventCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos del evento y sus zonas." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const slug = input.slug || slugify(input.title);
  if (!slug) {
    return NextResponse.json({ error: "El título no permite generar una URL válida." }, { status: 400 });
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && endsAt <= startsAt) {
    return NextResponse.json({ error: "La fecha de término debe ser posterior al inicio." }, { status: 400 });
  }
  if (input.status === EventStatus.PUBLISHED && startsAt <= new Date()) {
    return NextResponse.json({ error: "Un evento publicado debe tener una fecha futura." }, { status: 400 });
  }

  const venue = await prisma.venue.findUnique({
    where: { id: input.venueId },
    select: { id: true, timeZone: true },
  });
  if (!venue) {
    return NextResponse.json({ error: "Selecciona un recinto existente." }, { status: 400 });
  }

  try {
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          slug,
          title: input.title,
          artist: input.artist,
          description: input.description,
          category: input.category,
          status: input.status,
          startsAt,
          endsAt,
          timeZone: venue.timeZone,
          venueId: venue.id,
          ticketZones: {
            create: input.zones.map((zone) => ({
              name: zone.name,
              description: zone.description,
              priceCents: priceToCents(zone.priceMxn),
              inventoryTotal: zone.inventoryTotal,
              isReservedSeating: zone.isReservedSeating,
            })),
          },
        },
        select: { id: true, slug: true, title: true },
      });
      await tx.auditLog.create({
        data: {
          userId: authorization.userId,
          action: "ADMIN_EVENT_CREATED",
          entityType: "Event",
          entityId: created.id,
          details: {
            slug: created.slug,
            title: created.title,
            venueId: venue.id,
            status: input.status,
            zoneCount: input.zones.length,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return created;
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ya existe un evento con esa URL o una zona duplicada." }, { status: 409 });
    }
    throw error;
  }
}
