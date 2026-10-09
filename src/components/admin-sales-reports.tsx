"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminRequest } from "@/components/admin-event-management";

type ReportSummary = {
  orders: number;
  paidOrders: number;
  grossCents: string;
  refundedOrders: number;
  refundedCents: string;
};

type DailySales = {
  date: string;
  orders: number;
  paidOrders: number;
  grossCents: string;
  refundedOrders: number;
  refundedCents: string;
};

type SalesReport = {
  from: string;
  to: string;
  summary: ReportSummary;
  daily: DailySales[];
};

function formatPrice(cents: string | number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export default function AdminSalesReports({
  request,
  defaultFrom,
  defaultTo,
}: {
  request: AdminRequest;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  async function loadReport(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const query = new URLSearchParams({ from, to });
      const result = await request<SalesReport>(
        `/api/admin/reportes?${query.toString()}`,
      );
      setReport(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo consultar el reporte.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function exportReport() {
    setError("");
    setIsExporting(true);
    try {
      const response = await fetch(csvUrl, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        let message = "No se pudo exportar el reporte.";
        try {
          const result: { error?: string } = await response.json();
          message = result.error ?? message;
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `ventas_${from}_${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "No se pudo exportar el reporte.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const csvUrl = `/api/admin/exportaciones/ventas?${new URLSearchParams({ from, to }).toString()}`;
  const maxDailySales = Math.max(
    1,
    ...(report?.daily.map((day) => Number(day.grossCents)) ?? []),
  );

  return (
    <section className="admin-reports">
      <div className="admin-section-heading">
        <span className="section-kicker">VENTAS</span>
        <h2>Una vista clara del negocio.</h2>
        <p>Órdenes confirmadas, devoluciones y actividad por día.</p>
      </div>

      <form className="admin-report-filters" onSubmit={loadReport}>
        <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
        <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        <button className="button-primary" type="submit" disabled={isLoading}>
          {isLoading ? "Consultando..." : "Actualizar reporte"}
        </button>
        <button
          className="button-secondary admin-export-button"
          type="button"
          disabled={isExporting}
          onClick={() => void exportReport()}
        >
          {isExporting ? "Preparando CSV..." : "Exportar ventas CSV"} <span aria-hidden="true">↓</span>
        </button>
      </form>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {report ? (
        <>
          <div className="admin-report-cards">
            <article><span>Ventas brutas registradas</span><strong>{formatPrice(report.summary.grossCents)}</strong><small>MXN · pagos no reembolsados completamente</small></article>
            <article><span>Órdenes pagadas</span><strong>{report.summary.paidOrders.toLocaleString("es-MX")}</strong><small>En el periodo seleccionado</small></article>
            <article><span>Órdenes reembolsadas</span><strong>{report.summary.refundedOrders.toLocaleString("es-MX")}</strong><small>Reembolso completo registrado</small></article>
            <article><span>Importe reembolsado</span><strong>{formatPrice(report.summary.refundedCents)}</strong><small>No incluye reembolsos parciales</small></article>
          </div>
          <div className="admin-report-chart">
            <div className="admin-report-chart-heading">
              <div><span className="section-kicker">TENDENCIA</span><h3>Ventas por día.</h3></div>
              <span>{report.from} — {report.to}</span>
            </div>
            {report.daily.length === 0 ? (
              <p className="admin-empty">No hay órdenes en este periodo.</p>
            ) : (
              <div className="admin-chart-rows">
                {report.daily.map((day) => (
                  <div className="admin-chart-row" key={day.date}>
                    <time dateTime={day.date}>{formatDate(day.date)}</time>
                    <div className="admin-chart-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(2, (Number(day.grossCents) / maxDailySales) * 100)}%` }} />
                    </div>
                    <strong>{formatPrice(day.grossCents)}</strong>
                    <small>{day.paidOrders} pagadas</small>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="admin-inline-note">
            El reporte usa días de Ciudad de México. Las órdenes parcialmente reembolsadas se muestran dentro de ventas pagadas; el importe exacto parcial no está disponible porque la pasarela no lo persiste actualmente.
          </p>
        </>
      ) : (
        <div className="admin-empty admin-report-empty">
          <p>Elige el periodo y actualiza para consultar las ventas.</p>
          <button className="button-secondary" type="button" disabled={isLoading} onClick={() => void loadReport()}>
            Cargar últimos 30 días
          </button>
        </div>
      )}
    </section>
  );
}
