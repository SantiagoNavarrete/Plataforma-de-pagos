import { EventCategory, EventStatus } from "@prisma/client";
import { z } from "zod";

const isValidPrice = (amount: number) =>
  Math.abs(amount * 100 - Math.round(amount * 100)) < 0.0000001;

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone }).format(new Date());
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

const ticketZoneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(300),
  priceMxn: z
    .number()
    .finite()
    .min(0.01)
    .max(10_000_000)
    .refine(isValidPrice),
  inventoryTotal: z.number().int().min(0).max(10_000_000),
  isReservedSeating: z.boolean().default(false),
}).strict();

export const ticketZoneCreateSchema = ticketZoneSchema;

export const venueCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(80).default("México"),
  postalCode: z.string().trim().max(12).nullable().optional(),
  timeZone: z.string().trim().min(1).max(80).refine(isValidTimeZone),
}).strict();

export const eventCreateSchema = z.object({
  title: z.string().trim().min(2).max(200),
  artist: z.string().trim().min(2).max(200),
  description: z.string().trim().min(10).max(10_000),
  category: z.nativeEnum(EventCategory),
  status: z.nativeEnum(EventStatus).default(EventStatus.DRAFT),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  venueId: z.string().uuid(),
  slug: z
    .string()
    .trim()
    .max(180)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  zones: z.array(ticketZoneSchema).min(1).max(30).refine(
    (zones) => new Set(zones.map((zone) => zone.name.toLocaleLowerCase("es-MX"))).size === zones.length,
    "No repitas el nombre de una zona.",
  ),
}).strict();

export const eventUpdateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  artist: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().min(10).max(10_000).optional(),
  category: z.nativeEnum(EventCategory).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  venueId: z.string().uuid().optional(),
}).strict().refine((data) => Object.keys(data).length > 0);

export const ticketZoneUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(300).optional(),
  priceMxn: z
    .number()
    .finite()
    .min(0.01)
    .max(10_000_000)
    .refine(isValidPrice)
    .optional(),
  inventoryTotal: z.number().int().min(0).max(10_000_000).optional(),
  isReservedSeating: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0);

export function priceToCents(priceMxn: number) {
  return Math.round(priceMxn * 100);
}
