import type { Metadata } from "next";
import AdminConsole from "@/components/admin-console";

export const metadata: Metadata = {
  title: "Administración",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function dateInMexico(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .filter((part) => part.type !== "literal");
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export default function AdminPage() {
  const defaultTo = dateInMexico(new Date());
  const defaultFrom = new Date(`${defaultTo}T00:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  return (
    <AdminConsole
      defaultFrom={defaultFrom.toISOString().slice(0, 10)}
      defaultTo={defaultTo}
    />
  );
}
