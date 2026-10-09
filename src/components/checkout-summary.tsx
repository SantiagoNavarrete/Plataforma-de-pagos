"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/events";

export type CheckoutItem = {
  slug: string;
  title: string;
  zone: string;
  quantity: number;
  unitPriceCents: number;
  startsAt: string;
  timeZone: string;
};

type CheckoutSummaryProps = {
  orderNumber: string;
  status: string;
  reservationEndsAt: string | null;
  subtotalCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalCents: number;
  paymentUrl: string | null;
  paymentStatus: string | null;
  items: CheckoutItem[];
};

function formatEventDate(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeZone,
  }).format(new Date(date));
}

export default function CheckoutSummary({
  orderNumber,
  status,
  reservationEndsAt,
  subtotalCents,
  serviceFeeCents,
  taxCents,
  totalCents,
  paymentUrl,
  paymentStatus,
  items,
}: CheckoutSummaryProps) {
  const router = useRouter();
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    reservationEndsAt
      ? Math.max(0, Math.floor((new Date(reservationEndsAt).getTime() - Date.now()) / 1000))
      : 0,
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [error, setError] = useState("");
  const hasOpenReservation =
    status === "PENDING" || status === "PAYMENT_PENDING";
  const reservationExpired =
    status === "EXPIRED" || (hasOpenReservation && remainingSeconds === 0);
  const reservationActive = hasOpenReservation && !reservationExpired;

  useEffect(() => {
    if (!reservationEndsAt || !reservationActive) return;

    const updateCountdown = () => {
      setRemainingSeconds(
        Math.max(
          0,
          Math.floor((new Date(reservationEndsAt).getTime() - Date.now()) / 1000),
        ),
      );
    };

    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [reservationEndsAt, reservationActive]);

  useEffect(() => {
    if (status !== "PAYMENT_PENDING") return;
    const refreshStatus = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(refreshStatus);
  }, [router, status]);

  async function startPayment() {
    if (paymentUrl) {
      window.location.assign(paymentUrl);
      return;
    }

    setIsStartingPayment(true);
    setError("");
    try {
      const response = await fetch(
        `/api/reservas/${encodeURIComponent(orderNumber)}/pago`,
        { method: "POST" },
      );
      const result: { checkoutUrl?: string; error?: string } = await response.json();
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(result.error ?? "No pudimos iniciar el pago. Intenta de nuevo.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "No pudimos iniciar el pago. Intenta de nuevo.",
      );
      setIsStartingPayment(false);
    }
  }

  async function cancelReservation() {
    setIsCancelling(true);
    setError("");
    try {
      const response = await fetch(`/api/reservas/${encodeURIComponent(orderNumber)}`, {
        method: "DELETE",
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "No se pudo cancelar la reserva.");
      }
      router.refresh();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "No se pudo cancelar la reserva.",
      );
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <div className="checkout-layout">
      <section className="checkout-main">
        <span className="section-kicker">CASI ES TUYO</span>
        <h1>Revisa tu <span>pedido.</span></h1>
        <p className="checkout-intro">Revisa que todo esté en orden antes de elegir cómo pagar.</p>

        <div className="checkout-order-meta">
          <span>ORDEN <strong>{orderNumber}</strong></span>
          {reservationActive && (
            <span className="reservation-countdown" aria-live="polite">
              <span aria-hidden="true">◷</span> Apartados por {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
            </span>
          )}
          {reservationExpired && <span className="reservation-status reservation-status--expired">Reserva vencida</span>}
          {status === "CANCELLED" && <span className="reservation-status">Reserva cancelada</span>}
        </div>

        <div className="checkout-items">
          {items.map((item, index) => (
            <article className="checkout-item" key={`${item.title}-${item.zone}-${index}`}>
              <div className="checkout-item-heading">
                <span className="checkout-item-dot" aria-hidden="true">✳</span>
                <div><h2>{item.title}</h2><p>{item.zone} · {formatEventDate(item.startsAt, item.timeZone)}</p></div>
              </div>
              <div className="checkout-item-price">
                <span>{item.quantity} × {formatPrice(item.unitPriceCents / 100)}</span>
                <strong>{formatPrice(item.quantity * item.unitPriceCents / 100)}</strong>
              </div>
            </article>
          ))}
        </div>

        <div className="checkout-no-payment">
          <span aria-hidden="true">◈</span>
          <div>
            <strong>{status === "CONFIRMED" ? "Pago confirmado." : "Tu total, sin sorpresas."}</strong>
            <p>
              {paymentStatus === "FAILED"
                ? "El pago no se completó. Puedes volver a Mercado Pago para probar otro método."
                : status === "PAYMENT_PENDING"
                  ? "Esperamos la confirmación segura de Mercado Pago."
                : status === "CONFIRMED"
                  ? "Te enviaremos tus boletos digitales al correo de la orden."
                  : "Paga de forma segura en Mercado Pago; nunca recibimos los datos de tu tarjeta."}
            </p>
          </div>
        </div>
      </section>

      <aside className="checkout-totals">
        <span className="section-kicker">DESGLOSE CLARO</span>
        <h2>Tu total.</h2>
        <div className="checkout-price-lines">
          <div className="price-line"><span>Boletos</span><span>{formatPrice(subtotalCents / 100)}</span></div>
          <div className="price-line"><span>IVA (16%)</span><span>{formatPrice(taxCents / 100)}</span></div>
          <div className="price-line"><span>Cargo de servicio</span><span>{formatPrice(serviceFeeCents / 100)}</span></div>
          <div className="price-line price-line--total"><span>Total en MXN</span><strong>{formatPrice(totalCents / 100)}</strong></div>
        </div>
        {reservationActive ? (
          <>
            <button className="button-primary ticket-cta checkout-pay-button" type="button" disabled={isStartingPayment} onClick={startPayment}>
              {isStartingPayment ? "Conectando con Mercado Pago..." : paymentUrl ? "Continuar en Mercado Pago" : "Pagar con Mercado Pago"} <span aria-hidden="true">→</span>
            </button>
            {status === "PENDING" && (
              <button className="cancel-reservation" type="button" disabled={isCancelling} onClick={cancelReservation}>
                {isCancelling ? "Cancelando..." : "Cancelar mi reserva"}
              </button>
            )}
          </>
        ) : reservationExpired || status === "CANCELLED" ? (
          <p className="checkout-expired-help">Vuelve al evento para elegir boletos disponibles y crear una nueva reserva.</p>
        ) : (
          <p className="checkout-expired-help">El estado de tu pedido es {status.toLocaleLowerCase("es-MX")}.</p>
        )}
        {error && <p className="reservation-error" role="alert">{error}</p>}
        <p className="secure-note"><span aria-hidden="true">◈</span> {status === "CONFIRMED" ? "Pago confirmado por la pasarela" : "Pago procesado de forma segura por la pasarela"}</p>
      </aside>
    </div>
  );
}
