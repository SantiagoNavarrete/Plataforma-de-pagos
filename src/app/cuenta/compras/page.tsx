import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrderStatus } from "@prisma/client";
import { isAuthenticationConfigured } from "@/lib/auth-config";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mis compras",
  robots: { index: false, follow: false },
};

const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: "Reserva pendiente",
  PAYMENT_PENDING: "Pago pendiente",
  CONFIRMED: "Compra confirmada",
  EXPIRED: "Reserva vencida",
  CANCELLED: "Compra cancelada",
  REFUNDED: "Reembolsada",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};

function formatPrice(cents: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(cents / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(date);
}

export default async function AccountPurchasesPage() {
  if (!isAuthenticationConfigured()) redirect("/cuenta");

  const session = await (await import("@/lib/auth")).auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/cuenta?callbackUrl=%2Fcuenta%2Fcompras");

  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      orderNumber: true,
      status: true,
      totalCents: true,
      createdAt: true,
      items: {
        select: {
          quantity: true,
          event: { select: { title: true, startsAt: true, timeZone: true } },
          ticketZone: { select: { name: true } },
        },
      },
    },
  });

  return (
    <main className="account-orders-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <Link className="back-link" href="/cuenta">Volver a mi cuenta</Link>
        <span className="checkout-secure-label">MIS COMPRAS</span>
      </header>
      <section className="account-orders-content">
        <span className="section-kicker">TU HISTORIAL</span>
        <h1>Mis <span>compras.</span></h1>
        {!orders.length ? (
          <div className="empty-state">
            <h2>Aún no tienes compras vinculadas.</h2>
            <p>Al iniciar sesión durante la compra, tus órdenes aparecerán aquí. También puedes comprar como invitado.</p>
            <Link className="button-primary" href="/">Descubrir eventos <span aria-hidden="true">→</span></Link>
          </div>
        ) : (
          <div className="account-order-list">
            {orders.map((order) => {
              const canViewTickets =
                order.status === OrderStatus.CONFIRMED ||
                order.status === OrderStatus.PARTIALLY_REFUNDED;
              const canContinuePayment =
                order.status === OrderStatus.PENDING ||
                order.status === OrderStatus.PAYMENT_PENDING;
              return (
                <article className="account-order-card" key={order.orderNumber}>
                  <div className="account-order-heading">
                    <div>
                      <span className="section-kicker">ORDEN {order.orderNumber}</span>
                      <h2>{order.items.map((item) => item.event.title).join(" · ")}</h2>
                    </div>
                    <strong>{formatPrice(order.totalCents)}</strong>
                  </div>
                  <p>{orderStatusLabels[order.status]} · {formatDate(order.createdAt)}</p>
                  <ul>
                    {order.items.map((item, index) => (
                      <li key={`${order.orderNumber}-${index}`}>
                        {item.quantity} × {item.ticketZone.name} — {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: item.event.timeZone }).format(item.event.startsAt)}
                      </li>
                    ))}
                  </ul>
                  {canViewTickets && (
                    <Link className="button-primary" href={`/mis-boletos/${encodeURIComponent(order.orderNumber)}`}>
                      Ver boletos <span aria-hidden="true">→</span>
                    </Link>
                  )}
                  {canContinuePayment && (
                    <Link className="button-secondary" href={`/checkout/${encodeURIComponent(order.orderNumber)}`}>
                      Ver pago pendiente <span aria-hidden="true">→</span>
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
