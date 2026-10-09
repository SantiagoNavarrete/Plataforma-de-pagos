import type { Metadata } from "next";
import { PaymentProvider } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import CheckoutSummary, { type CheckoutItem } from "@/components/checkout-summary";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/reservations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
};

type CheckoutPageProps = {
  params: Promise<{ orderNumber: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { orderNumber } = await params;
  const order = await prisma.$transaction(async (tx) => {
    await releaseExpiredReservations(tx);
    return tx.order.findUnique({
      where: { orderNumber },
      select: {
        orderNumber: true,
        status: true,
        subtotalCents: true,
        serviceFeeCents: true,
        taxCents: true,
        totalCents: true,
        reservationEndsAt: true,
        payments: {
          where: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerPreferenceId: { not: null },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { checkoutUrl: true, status: true },
        },
        items: {
          select: {
            quantity: true,
            unitPriceCents: true,
            event: {
              select: { slug: true, title: true, startsAt: true, timeZone: true },
            },
            ticketZone: { select: { name: true } },
          },
        },
      },
    });
  });

  if (!order) notFound();

  const items: CheckoutItem[] = order.items.map((item) => ({
    slug: item.event.slug,
    title: item.event.title,
    zone: item.ticketZone.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    startsAt: item.event.startsAt.toISOString(),
    timeZone: item.event.timeZone,
  }));

  return (
    <main id="inicio" className="checkout-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <Link className="back-link checkout-back-link" href={order.items[0] ? `/eventos/${order.items[0].event.slug}` : "/"}>
          <span aria-hidden="true">←</span> Seguir viendo eventos
        </Link>
        <span className="checkout-secure-label">COMPRA SEGURA&nbsp; ◈</span>
      </header>

      <div className="checkout-content">
        <nav className="breadcrumbs" aria-label="Migas de pan">
          <Link href="/">Inicio</Link><span aria-hidden="true">/</span><span aria-current="page">Tu pedido</span>
        </nav>
        <CheckoutSummary
          orderNumber={order.orderNumber}
          status={order.status}
          reservationEndsAt={order.reservationEndsAt?.toISOString() ?? null}
          subtotalCents={order.subtotalCents}
          serviceFeeCents={order.serviceFeeCents}
          taxCents={order.taxCents}
          totalCents={order.totalCents}
          paymentUrl={order.payments[0]?.checkoutUrl ?? null}
          paymentStatus={order.payments[0]?.status ?? null}
          items={items}
        />
      </div>

      <footer className="site-footer">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">b.</span><span>boleta<span className="brand-period">.</span></span></Link>
        <span>Precios claros. Mejores planes.</span>
      </footer>
    </main>
  );
}
