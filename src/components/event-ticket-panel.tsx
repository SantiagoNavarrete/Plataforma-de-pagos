"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Event } from "@/lib/events";
import { formatPrice } from "@/lib/events";
import { authClient } from "@/lib/auth-client";

export default function EventTicketPanel({ event }: { event: Event }) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tickets, setTickets] = useState(event.tickets);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [inventoryError, setInventoryError] = useState("");

  useEffect(() => {
    let active = true;

    async function refreshInventory() {
      try {
        const response = await fetch("/api/eventos", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("No pudimos consultar la disponibilidad de los boletos.");
        }

        const catalog: {
          events?: Array<{
            slug: string;
            tickets: Array<{
              id: string;
              name: string;
              description: string;
              price: number;
              available: number;
            }>;
          }>;
        } = await response.json();
        const savedEvent = catalog.events?.find((item) => item.slug === event.slug);
        if (!savedEvent) {
          throw new Error("Este evento no está disponible para reservar.");
        }

        const currentTickets = event.tickets.map((item) => {
          const savedTicket = savedEvent.tickets.find((ticket) => ticket.id === item.id);
          if (!savedTicket) {
            throw new Error("No encontramos una zona de boletos vigente para este evento.");
          }
          return {
            ...item,
            name: savedTicket.name,
            description: savedTicket.description,
            price: savedTicket.price,
            available: Math.max(0, savedTicket.available),
          };
        });

        if (active) {
          setTickets(currentTickets);
          setInventoryReady(true);
          setInventoryError("");
        }
      } catch (inventoryFailure) {
        if (active) {
          setInventoryReady(false);
          setInventoryError(
            inventoryFailure instanceof Error
              ? inventoryFailure.message
              : "No pudimos consultar la disponibilidad de los boletos.",
          );
        }
      }
    }

    void refreshInventory();
    const interval = window.setInterval(refreshInventory, 15_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [event]);

  const ticket = tickets.find((item) => item.name === selected);
  const unitPriceCents = ticket ? Math.round(ticket.price * 100) : 0;
  const subtotalCents = unitPriceCents * quantity;
  const taxCents = Math.round(subtotalCents * 0.16);
  const totalCents = subtotalCents + taxCents;

  async function createReservation(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!ticket) return;

    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventSlug: event.slug,
          email: session?.user.email ?? email,
          items: [{ ticketZoneId: ticket.id, quantity }],
        }),
      });
      const result: { orderNumber?: string; error?: string } = await response.json();

      if (!response.ok || !result.orderNumber) {
        throw new Error(result.error ?? "No se pudo crear la reserva. Intenta de nuevo.");
      }

      router.push(`/checkout/${encodeURIComponent(result.orderNumber)}`);
    } catch (reservationError) {
      setError(
        reservationError instanceof Error
          ? reservationError.message
          : "No se pudo crear la reserva. Intenta de nuevo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <aside className="ticket-panel" id="boletos">
      <div className="ticket-panel-top"><span>ESCOGE CÓMO VIVIRLO</span><span className="ticket-live"><span className="live-dot" /> DISPONIBLES</span></div>
      <h2>Tus boletos.</h2>
      <p className="ticket-panel-subtitle">Elige la experiencia que va contigo.</p>
      <div className="ticket-options">
        {tickets.map((item) => (
          <button className={`ticket-option${selected === item.name ? " ticket-option--selected" : ""}`} key={item.name} type="button" aria-pressed={selected === item.name} disabled={!inventoryReady || item.available === 0} onClick={() => { setSelected(item.name); setError(""); }}>
            <span className="ticket-radio" aria-hidden="true">{selected === item.name && <span />}</span>
            <span className="ticket-option-copy"><strong>{item.name}</strong><span>{item.description}</span><span className="ticket-availability">{inventoryReady ? `${item.available} disponibles` : "Consultando disponibilidad..."}</span></span>
            <span className="ticket-option-price">{formatPrice(item.price)}<small> MXN / boleto</small></span>
          </button>
        ))}
      </div>

      {ticket && (
        <div className="quantity-row">
          <span>Cantidad</span>
          <div className="quantity-control">
            <button type="button" aria-label="Quitar un boleto" disabled={quantity <= 1} onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
            <span aria-live="polite">{quantity}</span>
            <button type="button" aria-label="Agregar un boleto" disabled={quantity >= Math.min(8, ticket.available)} onClick={() => setQuantity((current) => Math.min(Math.min(8, ticket.available), current + 1))}>+</button>
          </div>
        </div>
      )}

      {ticket && (
        <div className="ticket-total">
          <div className="price-line"><span>{quantity} {quantity === 1 ? "boleto" : "boletos"}</span><span>{formatPrice(subtotalCents / 100)}</span></div>
          <div className="price-line"><span>IVA (16%)</span><span>{formatPrice(taxCents / 100)}</span></div>
          <div className="price-line"><span>Cargo de servicio</span><span>{formatPrice(0)}</span></div>
          <div className="price-line price-line--total"><span>Total en MXN</span><strong>{formatPrice(totalCents / 100)}</strong></div>
        </div>
      )}

      {ticket ? (
        <form onSubmit={createReservation}>
          <label className="checkout-email-label" htmlFor="reservation-email">
            {session?.user.email ? "Correo de tu cuenta" : "Correo para tu reserva"}
          </label>
          <input
            id="reservation-email"
            className="checkout-email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
            disabled={Boolean(session?.user.email)}
            value={session?.user.email ?? email}
            onChange={(inputEvent) => setEmail(inputEvent.target.value)}
            placeholder="tu@correo.com"
          />
          <button className="button-primary ticket-cta" type="submit" disabled={!inventoryReady || isSubmitting || ticket.available === 0}>
            {isSubmitting ? "Apartando tus boletos..." : ticket.available === 0 ? "Zona agotada" : "Apartar por 10 minutos"} <span aria-hidden="true">→</span>
          </button>
        </form>
      ) : (
        <button className="button-primary ticket-cta" type="button" disabled>
          Elige tu tipo de boleto <span aria-hidden="true">→</span>
        </button>
      )}
      <p className="secure-note"><span aria-hidden="true">◈</span> Total claro · Reserva temporal · Sin cargo de servicio</p>
      {inventoryError && <p className="reservation-error" role="alert">{inventoryError}</p>}
      {error && <p className="reservation-error" role="alert">{error}</p>}
    </aside>
  );
}
