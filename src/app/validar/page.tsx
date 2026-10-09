import type { Metadata } from "next";
import TicketValidator from "@/components/ticket-validator";

export const metadata: Metadata = {
  title: "Validar boletos",
  robots: { index: false, follow: false },
};

export default function ValidateTicketsPage() {
  return <TicketValidator />;
}
