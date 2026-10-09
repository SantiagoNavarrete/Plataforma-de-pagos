import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { slugify, venueCreateSchema } from "@/lib/admin-shared";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  const venues = await prisma.venue.findMany({
    orderBy: [{ city: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      country: true,
      postalCode: true,
      timeZone: true,
    },
  });
  return NextResponse.json(
    { venues },
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

  const parsed = venueCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos del recinto." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const slug = slugify(`${input.name}-${input.city}`);
  if (!slug) {
    return NextResponse.json({ error: "El recinto no permite generar una URL válida." }, { status: 400 });
  }

  try {
    const venue = await prisma.$transaction(async (tx) => {
      const created = await tx.venue.create({
        data: { ...input, slug },
        select: { id: true, name: true, city: true, state: true },
      });
      await tx.auditLog.create({
        data: {
          userId: authorization.userId,
          action: "ADMIN_VENUE_CREATED",
          entityType: "Venue",
          entityId: created.id,
          details: {
            slug,
            city: created.city,
            state: created.state,
          } satisfies Prisma.InputJsonObject,
        },
      });
      return created;
    });
    return NextResponse.json({ venue }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ya existe un recinto con ese nombre y ciudad." }, { status: 409 });
    }
    throw error;
  }
}
