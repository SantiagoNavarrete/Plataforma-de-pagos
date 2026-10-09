import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { parseAdminReportRange } from "@/lib/admin-date-range";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type DailySalesRow = {
  date: string;
  orders: number;
  paidOrders: number;
  grossCents: string;
  refundedOrders: number;
  refundedCents: string;
};

export async function GET(request: Request) {
  const authorization = await requireAdminSession(request);
  if ("response" in authorization) return authorization.response;

  const range = parseAdminReportRange(request);
  if (!range.ok) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }

  const daily = await prisma.$queryRaw<DailySalesRow[]>(Prisma.sql`
    SELECT
      to_char(
        date_trunc('day', "createdAt" AT TIME ZONE 'America/Mexico_City'),
        'YYYY-MM-DD'
      ) AS "date",
      COUNT(*)::integer AS "orders",
      COUNT(*) FILTER (
        WHERE "status" IN ('CONFIRMED', 'PARTIALLY_REFUNDED')
      )::integer AS "paidOrders",
      COALESCE(
        SUM("totalCents") FILTER (
          WHERE "status" IN ('CONFIRMED', 'PARTIALLY_REFUNDED')
        ),
        0
      )::text AS "grossCents",
      COUNT(*) FILTER (WHERE "status" = 'REFUNDED')::integer AS "refundedOrders",
      COALESCE(
        SUM("totalCents") FILTER (WHERE "status" = 'REFUNDED'),
        0
      )::text AS "refundedCents"
    FROM "Order"
    WHERE "createdAt" >= ${range.startAt}
      AND "createdAt" < ${range.endExclusive}
    GROUP BY date_trunc('day', "createdAt" AT TIME ZONE 'America/Mexico_City')
    ORDER BY "date" ASC
  `);

  const summary = daily.reduce(
    (total, row) => ({
      orders: total.orders + row.orders,
      paidOrders: total.paidOrders + row.paidOrders,
      grossCents: (BigInt(total.grossCents) + BigInt(row.grossCents)).toString(),
      refundedOrders: total.refundedOrders + row.refundedOrders,
      refundedCents: (
        BigInt(total.refundedCents) + BigInt(row.refundedCents)
      ).toString(),
    }),
    {
      orders: 0,
      paidOrders: 0,
      grossCents: "0",
      refundedOrders: 0,
      refundedCents: "0",
    },
  );

  return NextResponse.json(
    {
      from: range.from,
      to: range.to,
      summary,
      daily: daily.map((row) => ({
        date: row.date,
        orders: row.orders,
        paidOrders: row.paidOrders,
        grossCents: row.grossCents,
        refundedOrders: row.refundedOrders,
        refundedCents: row.refundedCents,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
