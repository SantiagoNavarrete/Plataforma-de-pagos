import type { Metadata } from "next";
import Image from "next/image";
import { EventStatus, OrderStatus, TicketStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import InvoiceRequestForm from "@/components/invoice-request-form";
import PrintTicketsButton from "@/components/print-tickets-button";
import { isAuthenticationConfigured } from "@/lib/auth-config";
import { canRetryFacturamaFailure } from "@/lib/facturama";
import { createTicketCode, getTicketSecret, verifyOrderAccessToken } from "@/lib/tickets";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mis boletos",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type TicketsPageProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
};

function formatEventDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export default async function TicketsPage({
  params,
  searchParams,
}: TicketsPageProps) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.token === "string" ? query.token : "";
  const session = isAuthenticationConfigured()
    ? await (await import("@/lib/auth")).auth.api.getSession({
        headers: await headers(),
      })
    : null;
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      guestEmail: true,
      status: true,
      invoice: {
        select: {
          status: true,
          pdfUrl: true,
          xmlUrl: true,
          failureCode: true,
        },
      },
      tickets: {
        orderBy: [{ orderItemId: "asc" }, { sequence: "asc" }],
        select: {
          id: true,
          sequence: true,
          status: true,
          orderItem: {
            select: {
              event: {
                select: {
                  title: true,
                  startsAt: true,
                  timeZone: true,
                  status: true,
                  venue: { select: { name: true, city: true } },
                },
              },
            },
          },
          ticketZone: { select: { name: true } },
        },
      },
    },
  });

  if (
    !order ||
    (order.status !== OrderStatus.CONFIRMED &&
      order.status !== OrderStatus.PARTIALLY_REFUNDED) ||
    !(
      session?.user.id === order.userId ||
      (token && verifyOrderAccessToken(order.id, token, getTicketSecret()))
    )
  ) {
    notFound();
  }

  const ticketCodes = await Promise.all(
    order.tickets.map(async (ticket) => ({
      id: ticket.id,
      dataUrl:
        ticket.status === TicketStatus.VALID &&
        ticket.orderItem.event.status !== EventStatus.CANCELLED
          ? await QRCode.toDataURL(
              createTicketCode(ticket.id),
              { errorCorrectionLevel: "M", width: 320, margin: 2 },
            )
          : null,
    })),
  );
  const qrByTicketId = new Map(ticketCodes.map((ticket) => [ticket.id, ticket.dataUrl]));
  const isOrderOwner = session?.user.id === order.userId;

  return (
    <main className="ticket-portal-page">
      <header className="site-header no-print">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <Link className="back-link" href="/">Volver a eventos</Link>
        <span className="checkout-secure-label">MIS BOLETOS</span>
      </header>

      <section className="ticket-wallet">
        <span className="section-kicker">COMPRA CONFIRMADA</span>
        <h1>Tus <span>boletos.</span></h1>
        <p className="ticket-wallet-order">Orden {order.orderNumber} · Guarda cada código QR y presenta uno por persona.</p>
        <div className="ticket-wallet-actions no-print">
          <PrintTicketsButton />
        </div>

        {order.tickets.map((ticket) => {
          const event = ticket.orderItem.event;
          const qrCode = qrByTicketId.get(ticket.id);

          return (
            <article className="digital-ticket" key={ticket.id}>
              <div className="digital-ticket-info">
                <span className="section-kicker">BOLETO {ticket.sequence}</span>
                <h2>{event.title}</h2>
                <p>{ticket.ticketZone.name}</p>
                <p>{formatEventDate(event.startsAt, event.timeZone)}</p>
                <p>{event.venue.name} · {event.venue.city}</p>
                {ticket.status === TicketStatus.USED && (
                  <span className="ticket-used-label">Acceso registrado</span>
                )}
                {ticket.status === TicketStatus.REFUNDED && (
                  <span className="ticket-refunded-label">Boleto reembolsado</span>
                )}
                {ticket.status === TicketStatus.CANCELLED && (
                  <span className="ticket-refunded-label">
                    {event.status === EventStatus.CANCELLED
                      ? "Evento cancelado; consulta la política de reembolso."
                      : "Boleto cancelado"}
                  </span>
                )}
              </div>
              {qrCode ? (
                <Image
                  className="digital-ticket-qr"
                  src={qrCode}
                  width={220}
                  height={220}
                  unoptimized
                  alt={`Código QR único para el boleto ${ticket.sequence} de ${event.title}`}
                />
              ) : (
                <div className="digital-ticket-used" aria-label="El código QR ya fue utilizado">
                  ✓
                </div>
              )}
            </article>
          );
        })}
        {order.status === OrderStatus.CONFIRMED && (
          <InvoiceRequestForm
            orderNumber={order.orderNumber}
            invoice={order.invoice}
            accessToken={token}
            guestEmail={order.guestEmail}
            sessionEmail={session?.user.email ?? null}
            isOrderOwner={isOrderOwner}
            canRetry={Boolean(
              order.invoice?.status === "FAILED" &&
                canRetryFacturamaFailure(order.invoice.failureCode),
            )}
          />
        )}
      </section>
    </main>
  );
}
