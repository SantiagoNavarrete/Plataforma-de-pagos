import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import EventTicketPanel from "@/components/event-ticket-panel";
import { events, formatDate } from "@/lib/events";

type EventPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return events.map((event) => ({ slug: event.slug }));
}

export async function generateMetadata({
  params,
}: EventPageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = events.find((item) => item.slug === slug);

  return event
    ? {
        title: event.title,
        description: `${event.artist}. ${event.venue}, ${event.city}. Compra tus boletos en Boleta.`,
      }
    : {};
}

export default async function EventPage({ params }: EventPageProps) {
  const { slug } = await params;
  const event = events.find((item) => item.slug === slug);

  if (!event) notFound();

  return (
    <main className="event-page">
      <header className="site-header event-site-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <Link className="back-link" href="/">
          <span aria-hidden="true">←</span> Todos los eventos
        </Link>
        <a className="header-account" href="#boletos">Ver boletos <span aria-hidden="true">↓</span></a>
      </header>

      <div className="event-main">
        <nav className="breadcrumbs" aria-label="Migas de pan">
          <Link href="/">Inicio</Link>
          <span aria-hidden="true">/</span>
          <Link href="/#eventos">{event.category}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{event.title}</span>
        </nav>

        <section className={`event-hero ${event.colors}`}>
          <div className="event-poster-copy">
            <p className="poster-eyebrow">{event.artist}</p>
            <p className="poster-title">{event.artwork}</p>
            <div className="poster-rule" />
            <p className="poster-date">{formatDate(event.date)} · {event.city}</p>
          </div>
          <span className="poster-sticker">Una noche<br />para recordar</span>
          <div className="hero-image-caption">
            <span>EXPERIENCIAS QUE SE VIVEN EN PERSONA</span>
            <span>01 — 08</span>
          </div>
        </section>

        <div className="event-content-grid">
          <article className="event-description">
            <div className="event-eyebrow"><span>{event.category}</span><span className="eyebrow-dot" /> Venta oficial</div>
            <h1>{event.title}</h1>
            <p className="event-subtitle">{event.artist}</p>

            <div className="event-facts">
              <div className="event-fact">
                <span className="fact-icon" aria-hidden="true">▦</span>
                <div><span className="fact-label">Fecha y hora</span><span className="fact-value">{formatDate(event.date)} · {event.time} h (hora local)</span></div>
              </div>
              <div className="event-fact">
                <span className="fact-icon" aria-hidden="true">⌖</span>
                <div><span className="fact-label">Lugar</span><span className="fact-value">{event.venue}</span><span className="fact-detail">{event.city}, {event.state}</span></div>
              </div>
            </div>

            <div className="description-divider" />
            <h2>Sobre el evento</h2>
            <p className="description-copy">{event.description}</p>
            <a className="map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venue}, ${event.city}`)}`} target="_blank" rel="noreferrer">
              Ver ubicación en el mapa <span aria-hidden="true">↗</span>
            </a>
          </article>
          <EventTicketPanel event={event} />
        </div>

        <footer className="site-footer event-footer"><Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">b.</span><span>boleta<span className="brand-period">.</span></span></Link><span>Precios claros. Mejores planes.</span><a href="#inicio">Volver arriba ↑</a></footer>
      </div>
    </main>
  );
}
