"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import {
  zonedDateTimeToUtc,
} from "@/lib/admin-date-range";

type EventCategory = "CONCERT" | "THEATER" | "SPORT" | "FESTIVAL";
type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED" | "COMPLETED";
const eventCategories: EventCategory[] = ["CONCERT", "THEATER", "SPORT", "FESTIVAL"];
const eventStatuses: EventStatus[] = ["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"];

export type AdminVenue = {
  id: string;
  name: string;
  address: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  timeZone: string;
};

export type AdminZone = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  inventoryTotal: number;
  inventoryReserved: number;
  inventorySold: number;
  isReservedSeating: boolean;
};

export type AdminEvent = {
  id: string;
  slug: string;
  title: string;
  artist: string;
  category: EventCategory;
  status: EventStatus;
  startsAt: string;
  endsAt: string | null;
  timeZone: string;
  venue: { id: string; name: string; city: string; state: string };
  ticketZones: AdminZone[];
};

export type AdminRequest = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T>;

type ManagementProps = {
  events: AdminEvent[];
  venues: AdminVenue[];
  request: AdminRequest;
  onRefresh: () => Promise<void>;
};

const categoryLabels: Record<EventCategory, string> = {
  CONCERT: "Concierto",
  THEATER: "Teatro",
  SPORT: "Deportes",
  FESTIVAL: "Festival",
};

const statusLabels: Record<EventStatus, string> = {
  DRAFT: "Borrador",
  PUBLISHED: "Publicado",
  CANCELLED: "Cancelado",
  COMPLETED: "Concluido",
};

function formatEventDate(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(date));
}

function EventForm({
  venues,
  request,
  onCreated,
}: {
  venues: AdminVenue[];
  request: AdminRequest;
  onCreated: () => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [zones, setZones] = useState([{ name: "General", description: "Acceso general", price: "", inventory: "100" }]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const venue = venues.find((item) => item.id === form.get("venueId"));
    if (!venue) {
      setError("Selecciona un recinto.");
      setIsSaving(false);
      return;
    }

    try {
      const startsAt = zonedDateTimeToUtc(
        String(form.get("startsAt")),
        venue.timeZone,
      ).toISOString();
      const payload = {
        title: String(form.get("title")),
        artist: String(form.get("artist")),
        description: String(form.get("description")),
        category: String(form.get("category")) as EventCategory,
        status: String(form.get("status")) as EventStatus,
        startsAt,
        venueId: venue.id,
        slug: String(form.get("slug")).trim() || undefined,
        zones: zones.map((zone) => ({
          name: zone.name,
          description: zone.description,
          priceMxn: Number(zone.price),
          inventoryTotal: Number(zone.inventory),
          isReservedSeating: false,
        })),
      };
      await request("/api/admin/eventos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      formElement.reset();
      setZones([{ name: "General", description: "Acceso general", price: "", inventory: "100" }]);
      await onCreated();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el evento.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function updateZone(index: number, field: "name" | "description" | "price" | "inventory", value: string) {
    setZones((current) =>
      current.map((zone, zoneIndex) =>
        zoneIndex === index ? { ...zone, [field]: value } : zone,
      ),
    );
  }

  return (
    <form className="admin-form admin-event-form" onSubmit={submit}>
      <div className="admin-form-heading">
        <div><span className="section-kicker">NUEVO EVENTO</span><h2>Publica una nueva fecha.</h2></div>
      </div>
      {venues.length === 0 ? (
        <p className="admin-inline-note">Primero crea un recinto para poder registrar eventos.</p>
      ) : (
        <>
          <div className="admin-form-grid">
            <label>Nombre del evento<input name="title" required maxLength={200} /></label>
            <label>Artista, equipo u obra<input name="artist" required maxLength={200} /></label>
            <label>Categoría
              <select name="category" defaultValue="CONCERT">
                {eventCategories.map((category) => (
                  <option value={category} key={category}>{categoryLabels[category]}</option>
                ))}
              </select>
            </label>
            <label>Estado inicial
              <select name="status" defaultValue="DRAFT">
                <option value="DRAFT">Borrador</option>
                <option value="PUBLISHED">Publicado</option>
              </select>
            </label>
            <label>Recinto
              <select name="venueId" required defaultValue="">
                <option value="" disabled>Selecciona un recinto</option>
                {venues.map((venue) => (
                  <option value={venue.id} key={venue.id}>{venue.name} · {venue.city}</option>
                ))}
              </select>
            </label>
            <label>Fecha y hora local del recinto
              <input name="startsAt" type="datetime-local" required />
            </label>
            <label>URL del evento (opcional)<input name="slug" maxLength={180} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="se-genera-desde-el-titulo" /></label>
            <label className="admin-form-wide">Descripción
              <textarea name="description" required minLength={10} maxLength={10000} rows={4} />
            </label>
          </div>

          <div className="admin-zones-editor">
            <div className="admin-zones-editor-heading">
              <div><span className="section-kicker">INVENTARIO INICIAL</span><h3>Zonas y precios.</h3></div>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setZones((current) => [...current, { name: "", description: "", price: "", inventory: "0" }])}
              >
                Agregar zona
              </button>
            </div>
            {zones.map((zone, index) => (
              <div className="admin-zone-input-row" key={index}>
                <label>Zona<input value={zone.name} onChange={(event) => updateZone(index, "name", event.target.value)} required maxLength={120} /></label>
                <label>Descripción<input value={zone.description} onChange={(event) => updateZone(index, "description", event.target.value)} required maxLength={300} /></label>
                <label>Precio MXN<input type="number" inputMode="decimal" min="0.01" step="0.01" value={zone.price} onChange={(event) => updateZone(index, "price", event.target.value)} required /></label>
                <label>Boletos<input type="number" inputMode="numeric" min="0" step="1" value={zone.inventory} onChange={(event) => updateZone(index, "inventory", event.target.value)} required /></label>
                {zones.length > 1 && (
                  <button className="admin-remove-zone" type="button" aria-label={`Quitar zona ${index + 1}`} onClick={() => setZones((current) => current.filter((_, zoneIndex) => zoneIndex !== index))}>×</button>
                )}
              </div>
            ))}
          </div>

          <button className="button-primary" type="submit" disabled={isSaving}>
            {isSaving ? "Guardando evento..." : "Crear evento"} <span aria-hidden="true">→</span>
          </button>
        </>
      )}
      {error && <p className="admin-error" role="alert">{error}</p>}
    </form>
  );
}

function VenueForm({
  request,
  onCreated,
}: {
  request: AdminRequest;
  onCreated: () => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    try {
      await request("/api/admin/recintos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      formElement.reset();
      await onCreated();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el recinto.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <span className="section-kicker">NUEVO RECINTO</span>
      <h2>Agrega una sede.</h2>
      <div className="admin-form-grid">
        <label>Nombre<input name="name" required minLength={2} maxLength={200} /></label>
        <label>Ciudad<input name="city" required minLength={2} maxLength={120} /></label>
        <label>Estado<input name="state" required minLength={2} maxLength={120} /></label>
        <label>Zona horaria IANA<input name="timeZone" defaultValue="America/Mexico_City" required maxLength={80} /></label>
        <label>Dirección<input name="address" maxLength={300} /></label>
        <label>Código postal<input name="postalCode" maxLength={12} /></label>
      </div>
      <button className="button-primary" type="submit" disabled={isSaving}>
        {isSaving ? "Guardando..." : "Crear recinto"} <span aria-hidden="true">→</span>
      </button>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </form>
  );
}

function AdminEventCard({
  event,
  request,
  onRefresh,
}: {
  event: AdminEvent;
  request: AdminRequest;
  onRefresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const availableStatuses: EventStatus[] =
    event.status === "CANCELLED" ? ["CANCELLED"] : eventStatuses;

  async function changeStatus(status: EventStatus) {
    if (
      status === "CANCELLED" &&
      !window.confirm("Cancelar el evento bloquea nuevos accesos, pero no tramita reembolsos automáticamente. ¿Continuar?")
    ) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await request(`/api/admin/eventos/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await onRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar el evento.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateZone(eventTarget: HTMLFormElement, zone: AdminZone) {
    const form = new FormData(eventTarget);
    setIsSaving(true);
    setError("");
    try {
      await request(`/api/admin/zonas/${zone.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceMxn: Number(form.get("priceMxn")),
          inventoryTotal: Number(form.get("inventoryTotal")),
        }),
      });
      await onRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar la zona.");
    } finally {
      setIsSaving(false);
    }
  }

  async function createZone(eventTarget: HTMLFormElement) {
    const form = new FormData(eventTarget);
    setIsSaving(true);
    setError("");
    try {
      await request(`/api/admin/eventos/${event.id}/zonas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description"),
          priceMxn: Number(form.get("priceMxn")),
          inventoryTotal: Number(form.get("inventoryTotal")),
          isReservedSeating: false,
        }),
      });
      eventTarget.reset();
      await onRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo agregar la zona.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="admin-event-card">
      <div className="admin-event-card-heading">
        <div>
          <span className="section-kicker">{categoryLabels[event.category]} · {event.slug}</span>
          <h3>{event.title}</h3>
          <p>{event.artist} · {event.venue.name}, {event.venue.city}</p>
          <p>{formatEventDate(event.startsAt, event.timeZone)}</p>
        </div>
        <label className="admin-status-select">
          Estado
          <select value={event.status} disabled={isSaving} onChange={(change) => void changeStatus(change.target.value as EventStatus)}>
            {availableStatuses.map((status) => (
              <option key={status} value={status}>{statusLabels[status]}</option>
            ))}
          </select>
        </label>
      </div>

      <details className="admin-event-inventory">
        <summary>Inventario y precios ({event.ticketZones.length} zonas)</summary>
        {event.ticketZones.map((zone) => (
          <form
            className="admin-zone-row"
            key={zone.id}
            onSubmit={(submit) => {
              submit.preventDefault();
              void updateZone(submit.currentTarget, zone);
            }}
          >
            <div className="admin-zone-name">
              <strong>{zone.name}</strong>
              <span>Vendidos {zone.inventorySold} · Reservados {zone.inventoryReserved} · Disponibles {zone.inventoryTotal - zone.inventorySold - zone.inventoryReserved}</span>
            </div>
            <label>Precio MXN<input name="priceMxn" type="number" min="0.01" step="0.01" defaultValue={(zone.priceCents / 100).toFixed(2)} required /></label>
            <label>Inventario total<input name="inventoryTotal" type="number" min="0" step="1" defaultValue={zone.inventoryTotal} required /></label>
            <button className="button-secondary" type="submit" disabled={isSaving}>Guardar</button>
          </form>
        ))}
        <form
          className="admin-zone-row admin-zone-row--new"
          onSubmit={(submit) => {
            submit.preventDefault();
            void createZone(submit.currentTarget);
          }}
        >
          <strong>Agregar zona</strong>
          <label>Nombre<input name="name" required maxLength={120} /></label>
          <label>Descripción<input name="description" required maxLength={300} /></label>
          <label>Precio MXN<input name="priceMxn" type="number" min="0.01" step="0.01" required /></label>
          <label>Boletos<input name="inventoryTotal" type="number" min="0" step="1" required /></label>
          <button className="button-secondary" type="submit" disabled={isSaving}>Agregar</button>
        </form>
      </details>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </article>
  );
}

export default function AdminEventManagement({
  events,
  venues,
  request,
  onRefresh,
}: ManagementProps) {
  return (
    <div className="admin-management-grid">
      <EventForm venues={venues} request={request} onCreated={onRefresh} />
      <section className="admin-event-list">
        <div className="admin-section-heading">
          <span className="section-kicker">CATÁLOGO</span>
          <h2>Eventos e inventario.</h2>
        </div>
        {events.length === 0 ? (
          <p className="admin-empty">Todavía no hay eventos registrados.</p>
        ) : (
          events.map((event) => (
            <AdminEventCard
              event={event}
              key={event.id}
              request={request}
              onRefresh={onRefresh}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function AdminVenueManagement({
  venues,
  request,
  onRefresh,
}: {
  venues: AdminVenue[];
  request: AdminRequest;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="admin-management-grid admin-venue-layout">
      <VenueForm request={request} onCreated={onRefresh} />
      <section className="admin-event-list">
        <div className="admin-section-heading">
          <span className="section-kicker">RECINTOS</span>
          <h2>Sedes registradas.</h2>
        </div>
        {venues.map((venue) => (
          <article className="admin-venue-card" key={venue.id}>
            <span aria-hidden="true">⌖</span>
            <div>
              <strong>{venue.name}</strong>
              <p>{venue.city}, {venue.state}</p>
              <small>{venue.timeZone}{venue.address ? ` · ${venue.address}` : ""}</small>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
