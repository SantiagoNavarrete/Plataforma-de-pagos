import {
  EventCategory,
  EventStatus,
  PrismaClient,
} from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { demoZoneId, events, type Event } from "../src/lib/events";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const categoryMap: Record<Event["category"], EventCategory> = {
  Conciertos: EventCategory.CONCERT,
  Teatro: EventCategory.THEATER,
  Deportes: EventCategory.SPORT,
  Festivales: EventCategory.FESTIVAL,
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function seed() {
  for (const event of events) {
    const venueSlug = slugify(event.venue);
    const venue = await prisma.venue.upsert({
      where: { slug: venueSlug },
      create: {
        slug: venueSlug,
        name: event.venue,
        city: event.city,
        state: event.state,
      },
      update: {
        name: event.venue,
        city: event.city,
        state: event.state,
      },
    });

    const startsAt = new Date(`${event.date}T${event.time}:00-06:00`);
    const savedEvent = await prisma.event.upsert({
      where: { slug: event.slug },
      create: {
        slug: event.slug,
        title: event.title,
        artist: event.artist,
        description: event.description,
        category: categoryMap[event.category],
        status: EventStatus.PUBLISHED,
        startsAt,
        venueId: venue.id,
      },
      update: {
        title: event.title,
        artist: event.artist,
        description: event.description,
        category: categoryMap[event.category],
        startsAt,
        venueId: venue.id,
      },
    });

    for (const ticket of event.tickets) {
      await prisma.ticketZone.upsert({
        where: {
          eventId_name: { eventId: savedEvent.id, name: ticket.name },
        },
        create: {
          id: demoZoneId(event.slug, ticket.name),
          eventId: savedEvent.id,
          name: ticket.name,
          description: ticket.description,
          priceCents: ticket.price * 100,
          inventoryTotal: ticket.available,
        },
        update: {
          description: ticket.description,
          priceCents: ticket.price * 100,
        },
      });
    }
  }
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("No se pudo cargar el catálogo de demostración:", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
