"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { categories, cities, events, formatDate, formatPrice } from "@/lib/events";

const categoryIcons: Record<string, string> = {
  Todos: "✳",
  Conciertos: "♫",
  Festivales: "✺",
  Deportes: "◉",
  Teatro: "▣",
};

export default function EventExplorer() {
  const [category, setCategory] = useState("Todos");
  const [city, setCity] = useState("Todas las ciudades");
  const [query, setQuery] = useState("");

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es-MX");
    return events.filter((event) => {
      const matchesCategory = category === "Todos" || event.category === category;
      const matchesCity = city === "Todas las ciudades" || event.city === city;
      const matchesQuery =
        !normalizedQuery ||
        `${event.title} ${event.artist} ${event.venue} ${event.city} ${event.category}`
          .toLocaleLowerCase("es-MX")
          .includes(normalizedQuery);
      return matchesCategory && matchesCity && matchesQuery;
    });
  }, [category, city, query]);

  return (
    <main id="inicio">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <nav className="header-nav" aria-label="Navegación principal">
          <a href="#eventos">Descubre</a>
          <a href="#categorias">Categorías</a>
          <a href="#nosotros">Cómo funciona</a>
        </nav>
        <Link className="header-account" href="/cuenta">Mi cuenta <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="intro-section">
        <div className="intro-topline"><span>HECHO PARA VIVIRSE</span><span>EVENTOS EN TODO MÉXICO&nbsp; ✳</span></div>
        <div className="intro-copy">
          <span className="intro-sticker" aria-hidden="true">TU PRÓXIMO<br />PLAN ESTÁ<br /><strong>AQUÍ ↘</strong></span>
          <p className="intro-kicker"><span className="live-dot" /> Los planes buenos empiezan aquí</p>
          <h1>La vida pasa<br />cuando <span>sales.</span></h1>
          <p className="intro-description">Conciertos, noches inolvidables y ese plan que llevas semanas diciendo que sí. Tu próximo recuerdo empieza con un boleto.</p>
          <a className="button-primary intro-cta" href="#eventos">Encuentra tu próximo plan <span aria-hidden="true">↓</span></a>
        </div>
        <div className="intro-side-note">BOLETOS OFICIALES<br />PARA MOMENTOS<br />QUE NO SE REPITEN</div>
        <div className="intro-bottomline"><span>CDMX&nbsp; · &nbsp;GUADALAJARA&nbsp; · &nbsp;ACAPULCO&nbsp; · &nbsp;Y MUCHO MÁS</span><span>02° 08′ N &nbsp; 102° 17′ O</span></div>
      </section>

      <section className="event-section" id="eventos">
        <div className="section-heading">
          <div>
            <span className="section-kicker">NO TE LO CUENTEN</span>
            <h2>Encuentra <span>tu evento.</span></h2>
          </div>
          <p className="section-aside">Buenos planes, cero complicaciones.<br />Escoge el tuyo.</p>
        </div>

        <form className="search-bar" role="search" onSubmit={(event) => event.preventDefault()}>
          <label className="search-input-wrap">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="sr-only">Buscar eventos, artistas o recintos</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="¿Qué se te antoja ver?" />
            {query && <button className="clear-search" type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">×</button>}
          </label>
          <label className="city-select-wrap">
            <span aria-hidden="true">⌖</span>
            <span className="sr-only">Filtrar por ciudad</span>
            <select value={city} onChange={(event) => setCity(event.target.value)}>
              {cities.map((cityOption) => <option key={cityOption}>{cityOption}</option>)}
            </select>
          </label>
          <button className="search-button" type="button" onClick={() => document.getElementById("lista-eventos")?.scrollIntoView({ behavior: "smooth" })}>Buscar <span aria-hidden="true">→</span></button>
        </form>

        <div className="category-row" id="categorias" aria-label="Filtrar por categoría">
          {categories.map((item) => (
            <button className={`category-chip${category === item ? " category-chip--active" : ""}`} key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>
              <span aria-hidden="true">{categoryIcons[item]}</span>{item}
            </button>
          ))}
        </div>

        <div className="events-list-header" id="lista-eventos">
          <h3>{query || city !== "Todas las ciudades" || category !== "Todos" ? "Tu búsqueda" : "Los que están dando de qué hablar"} <span>({filteredEvents.length})</span></h3>
          <span className="official-note"><span className="check-badge" aria-hidden="true">✓</span> Boletos oficiales</span>
        </div>

        {filteredEvents.length ? (
          <div className="events-grid">
            {filteredEvents.map((event, index) => (
              <Link className="event-card" href={`/eventos/${event.slug}`} key={event.slug}>
                <div className={`event-art ${event.colors}`}>
                  <span className="art-category">{event.category}</span>
                  <span className="art-number">0{index + 1}</span>
                  <span className="art-title">{event.artwork}</span>
                  <span className="art-date">{formatDate(event.date)}<span>·</span>{event.city}</span>
                  <span className="art-arrow" aria-hidden="true">↗</span>
                  <span className="art-orb" aria-hidden="true" />
                </div>
                <div className="event-card-info">
                  <div className="event-card-heading">
                    <div><span className="card-category">{event.category}</span><h4>{event.title}</h4></div>
                    <span className="event-card-arrow" aria-hidden="true">↗</span>
                  </div>
                  <p className="card-artist">{event.artist}</p>
                  <div className="card-details"><span>{formatDate(event.date)} · {event.venue}</span><span>Desde <strong>{formatPrice(event.priceFrom)}</strong></span></div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span aria-hidden="true">◉</span>
            <h3>No encontramos ese plan (todavía).</h3>
            <p>Prueba con otra búsqueda o quita algún filtro.</p>
            <button className="text-button" type="button" onClick={() => { setQuery(""); setCity("Todas las ciudades"); setCategory("Todos"); }}>Ver todos los eventos <span aria-hidden="true">→</span></button>
          </div>
        )}
      </section>

      <section className="manifesto" id="nosotros">
        <div className="manifesto-topline"><span>EL PLAN ES VIVIRLO</span><span>ESTÁS EN BUENAS MANOS ✳</span></div>
        <p>Menos vueltas.</p><h2>Más <span>momentos.</span></h2>
        <div className="manifesto-foot"><span>Encuentra tu evento, elige tus boletos y prepárate para vivirlo.</span><a href="#eventos">Así de fácil <span aria-hidden="true">↗</span></a></div>
      </section>

      <footer className="site-footer">
        <Link className="brand" href="/" aria-label="Boleta — inicio"><span className="brand-mark" aria-hidden="true">b.</span><span>boleta<span className="brand-period">.</span></span></Link>
        <span>Una buena historia empieza con un boleto.</span>
        <span>Hecho con cariño en México&nbsp; ✳</span>
      </footer>
    </main>
  );
}
