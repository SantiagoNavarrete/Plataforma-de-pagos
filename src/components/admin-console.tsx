"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import AdminEventManagement, {
  AdminVenueManagement,
} from "@/components/admin-event-management";
import type {
  AdminEvent,
  AdminRequest,
  AdminVenue,
} from "@/components/admin-event-management";
import AdminSalesReports from "@/components/admin-sales-reports";

type Tab = "resumen" | "eventos" | "recintos" | "ventas";
type SessionResponse = {
  authenticated: boolean;
  signedIn?: boolean;
  message?: string;
};
type EventsResponse = { events: AdminEvent[] };
type VenuesResponse = { venues: AdminVenue[] };
type ApiError = { error?: string };

class AdminSessionExpiredError extends Error {}

async function fetchAdminData<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("El servidor devolvió una respuesta no válida.");
    }
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401) throw new AdminSessionExpiredError();
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as ApiError).error === "string"
        ? (payload as ApiError).error
        : "No se pudo completar la operación.";
    throw new Error(message);
  }
  return payload as T;
}

const tabs: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "eventos", label: "Eventos e inventario" },
  { id: "recintos", label: "Recintos" },
  { id: "ventas", label: "Ventas y reportes" },
];

export default function AdminConsole({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("resumen");
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [venues, setVenues] = useState<AdminVenue[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const request: AdminRequest = useCallback(
    async <T,>(path: string, init?: RequestInit) => {
      try {
        return await fetchAdminData<T>(path, init);
      } catch (requestError) {
        if (requestError instanceof AdminSessionExpiredError) {
          setAuthenticated(false);
          setError("La sesión expiró. Vuelve a ingresar la clave administrativa.");
        }
        throw requestError;
      }
    },
    [],
  );

  const refreshData = useCallback(async () => {
    setIsLoadingData(true);
    setError("");
    try {
      const [eventResponse, venueResponse] = await Promise.all([
        request<EventsResponse>("/api/admin/eventos"),
        request<VenuesResponse>("/api/admin/recintos"),
      ]);
      setEvents(eventResponse.events);
      setVenues(venueResponse.venues);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los datos administrativos.";
      setError(message);
      throw loadError;
    } finally {
      setIsLoadingData(false);
    }
  }, [request]);

  useEffect(() => {
    let active = true;
    async function checkSession() {
      setIsCheckingSession(true);
      try {
        const session = await fetchAdminData<SessionResponse>("/api/admin/sesion");
        if (active && session.authenticated) {
          await refreshData();
          if (active) setAuthenticated(true);
        } else if (active) {
          setAuthenticated(false);
          setError(session.message ?? "Inicia sesión con una cuenta autorizada para administrar.");
        }
      } catch (sessionError) {
        if (active) {
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : "No se pudo comprobar la sesión administrativa.",
          );
        }
      } finally {
        if (active) setIsCheckingSession(false);
      }
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, [refreshData]);

  async function logout() {
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(result.error.message || "No se pudo cerrar la sesión.");
        return;
      }
      setAuthenticated(false);
      setEvents([]);
      setVenues([]);
      setNotice("La sesión se cerró correctamente.");
      router.replace("/cuenta");
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "No se pudo cerrar la sesión.");
    }
  }

  if (isCheckingSession) {
    return <main className="admin-loading" aria-live="polite">Comprobando acceso administrativo…</main>;
  }

  if (!authenticated) {
    return (
      <main className="admin-login-page">
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Boleta — inicio">
            <span className="brand-mark" aria-hidden="true">b.</span>
            <span>boleta<span className="brand-period">.</span></span>
          </Link>
          <span className="checkout-secure-label">ACCESO RESTRINGIDO</span>
        </header>
        <div className="admin-login-card">
          <span className="section-kicker">ADMINISTRACIÓN</span>
          <h1>Panel de <span>control.</span></h1>
          <p>Usa tu cuenta personal. Solo las cuentas con rol de administración pueden abrir este panel.</p>
          <Link className="button-primary" href="/cuenta?callbackUrl=%2Fadmin">
            Iniciar sesión <span aria-hidden="true">→</span>
          </Link>
          {error && <p className="admin-error" role="alert">{error}</p>}
          {notice && <p className="admin-inline-note" role="status">{notice}</p>}
          <small>El acceso se administra mediante cuentas individuales y roles protegidos.</small>
        </div>
      </main>
    );
  }

  const publishedEvents = events.filter((event) => event.status === "PUBLISHED").length;
  const totalInventory = events.reduce(
    (total, event) =>
      total +
      event.ticketZones.reduce(
        (zoneTotal, zone) => zoneTotal + zone.inventoryTotal,
        0,
      ),
    0,
  );
  const soldInventory = events.reduce(
    (total, event) =>
      total +
      event.ticketZones.reduce((zoneTotal, zone) => zoneTotal + zone.inventorySold, 0),
    0,
  );

  return (
    <main className="admin-shell">
      <header className="site-header admin-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <nav className="admin-top-nav" aria-label="Navegación de administración">
          <Link href="/">Ver tienda</Link>
          <Link href="/validar">Validar boletos</Link>
          <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
        </nav>
      </header>

      <div className="admin-content">
        <div className="admin-welcome">
          <div>
            <span className="section-kicker">PANEL ADMINISTRATIVO · CUENTA AUTORIZADA</span>
            <h1>La operación, <span>bajo control.</span></h1>
          </div>
          <button className="button-secondary" type="button" onClick={() => void refreshData().catch(() => {})} disabled={isLoadingData}>
            {isLoadingData ? "Actualizando..." : "Actualizar datos"}
          </button>
        </div>
        <div className="admin-tab-list" role="tablist" aria-label="Secciones del panel">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "admin-tab admin-tab--active" : "admin-tab"}
              id={`admin-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && authenticated && <p className="admin-error" role="alert">{error}</p>}
        {notice && <p className="admin-notice" role="status">{notice}</p>}

        <div role="tabpanel" aria-labelledby={`admin-tab-${activeTab}`}>
          {activeTab === "resumen" && (
            <section className="admin-overview">
              <div className="admin-overview-cards">
                <article><span>Eventos registrados</span><strong>{events.length}</strong><small>{publishedEvents} publicados</small></article>
                <article><span>Recintos</span><strong>{venues.length}</strong><small>En México</small></article>
                <article><span>Boletos vendidos</span><strong>{soldInventory.toLocaleString("es-MX")}</strong><small>De {totalInventory.toLocaleString("es-MX")} en inventario</small></article>
              </div>
              <div className="admin-overview-note">
                <span aria-hidden="true">✳</span>
                <p>Los precios e inventarios se guardan en PostgreSQL. Los cambios de capacidad no pueden reducir el inventario por debajo de boletos vendidos o reservados.</p>
              </div>
              <div className="admin-overview-links">
                <button className="button-primary" type="button" onClick={() => setActiveTab("eventos")}>Gestionar eventos <span aria-hidden="true">→</span></button>
                <button className="button-secondary" type="button" onClick={() => setActiveTab("ventas")}>Consultar ventas</button>
              </div>
            </section>
          )}
          {activeTab === "eventos" && (
            <AdminEventManagement
              events={events}
              venues={venues}
              request={request}
              onRefresh={refreshData}
            />
          )}
          {activeTab === "recintos" && (
            <AdminVenueManagement
              venues={venues}
              request={request}
              onRefresh={refreshData}
            />
          )}
          {activeTab === "ventas" && (
            <AdminSalesReports
              request={request}
              defaultFrom={defaultFrom}
              defaultTo={defaultTo}
            />
          )}
        </div>
        <p className="admin-security-note">
          Cada solicitud administrativa verifica la sesión individual y el rol en el servidor.
        </p>
      </div>
    </main>
  );
}
