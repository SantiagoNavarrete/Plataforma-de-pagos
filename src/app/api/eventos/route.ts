import { EventCategory, EventStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const categories: Record<EventCategory, string> = {
  CONCERT: "Conciertos",
  THEATER: "Teatro",
  SPORT: "Deportes",
  FESTIVAL: "Festivales",
};

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function GET() {
  const events = await prisma.event.findMany({
    where: { status: EventStatus.PUBLISHED },
    include: {
      venue: true,
      ticketZones: {
        orderBy: { priceCents: "asc" },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  return NextResponse.json({
    events: events.map((event) => ({
      slug: event.slug,
      title: event.title,
      artist: event.artist,
      description: event.description,
      category: categories[event.category],
      date: dateInTimeZone(event.startsAt, event.timeZone),
      time: new Intl.DateTimeFormat("en-GB", {
        timeZone: event.timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(event.startsAt),
      venue: event.venue.name,
      city: event.venue.city,
      state: event.venue.state,
      timeZone: event.timeZone,
      priceFrom:
        event.ticketZones.length > 0
          ? Math.min(...event.ticketZones.map((zone) => zone.priceCents)) / 100
          : 0,
      tickets: event.ticketZones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        description: zone.description,
        price: zone.priceCents / 100,
        available:
          zone.inventoryTotal - zone.inventoryReserved - zone.inventorySold,
      })),
    })),
  });
}
