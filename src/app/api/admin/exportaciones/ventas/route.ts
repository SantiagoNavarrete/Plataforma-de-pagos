import { OrderStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { parseAdminReportRange } from "@/lib/admin-date-range";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_EXPORT_ORDERS = 50_000;
const exportedStatuses = [
  OrderStatus.CONFIRMED,
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.REFUNDED,
];

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function formatMexicoDate(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Mexico_City",
  }).format(date);
}

export async function GET(request: Request) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  const range = parseAdminReportRange(request);
  if (!range.ok) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.startAt, lt: range.endExclusive },
      status: { in: exportedStatuses },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_EXPORT_ORDERS + 1,
    select: {
      orderNumber: true,
      createdAt: true,
      guestEmail: true,
      status: true,
      currency: true,
      subtotalCents: true,
      taxCents: true,
      totalCents: true,
      items: {
        select: {
          quantity: true,
          event: { select: { title: true } },
          ticketZone: { select: { name: true } },
        },
      },
    },
  });

  if (orders.length > MAX_EXPORT_ORDERS) {
    return NextResponse.json(
      { error: "El archivo excede 50,000 órdenes. Reduce el periodo de fechas." },
      { status: 413 },
    );
  }

  await prisma.auditLog.create({
    data: {
      userId: authorization.userId,
      action: "ADMIN_SALES_CSV_EXPORTED",
      entityType: "SalesReport",
      entityId: `${range.from}:${range.to}`,
      details: { rowCount: orders.length, from: range.from, to: range.to },
    },
  });

  const rows = [
    [
      "Orden",
      "Fecha (CDMX)",
      "Correo",
      "Estado",
      "Eventos y zonas",
      "Subtotal MXN",
      "IVA MXN",
      "Total MXN",
      "Moneda",
    ],
    ...orders.map((order) => [
      order.orderNumber,
      formatMexicoDate(order.createdAt),
      order.guestEmail,
      order.status,
      order.items
        .map((item) => `${item.quantity} x ${item.event.title} — ${item.ticketZone.name}`)
        .join(" | "),
      (order.subtotalCents / 100).toFixed(2),
      (order.taxCents / 100).toFixed(2),
      (order.totalCents / 100).toFixed(2),
      order.currency,
    ]),
  ];

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  return new NextResponse(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="ventas_${range.from}_${range.to}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
