"use client";

import { useState } from "react";

type ExistingInvoice = {
  status: string;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  failureCode?: string | null;
} | null;

type InvoiceRequestFormProps = {
  orderNumber: string;
  invoice: ExistingInvoice;
  accessToken: string;
  guestEmail: string;
  sessionEmail: string | null;
  isOrderOwner: boolean;
  canRetry: boolean;
};

function documentUrl(
  orderNumber: string,
  format: "pdf" | "xml",
  accessToken: string,
) {
  const path = `/api/facturas/${encodeURIComponent(orderNumber)}/${format}`;
  return accessToken ? `${path}?token=${encodeURIComponent(accessToken)}` : path;
}

export default function InvoiceRequestForm({
  orderNumber,
  invoice: initialInvoice,
  accessToken,
  guestEmail,
  sessionEmail,
  isOrderOwner,
  canRetry,
}: InvoiceRequestFormProps) {
  const requiresGuestEmail =
    !isOrderOwner && sessionEmail?.toLowerCase() !== guestEmail.toLowerCase();
  const [invoice, setInvoice] = useState(initialInvoice);
  const [allowRetry, setAllowRetry] = useState(canRetry);
  const [email, setEmail] = useState(guestEmail);
  const [rfc, setRfc] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxRegime, setTaxRegime] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [cfdiUse, setCfdiUse] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/facturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber,
          ...(accessToken ? { accessToken } : {}),
          ...(requiresGuestEmail ? { email } : {}),
          rfc,
          legalName,
          taxRegime,
          postalCode,
          cfdiUse,
        }),
      });
      const result: {
        invoice?: ExistingInvoice;
        error?: string;
      } = await response.json();
      if (!response.ok || !result.invoice) {
        throw new Error(result.error ?? "No se pudo solicitar la factura.");
      }
      setInvoice(result.invoice);
      setAllowRetry(false);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No se pudo solicitar la factura.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="invoice-request-card no-print" aria-labelledby="invoice-request-heading">
      <span className="section-kicker">FACTURACIÓN CFDI 4.0</span>
      <h2 id="invoice-request-heading">¿Necesitas factura?</h2>
      {invoice && !allowRetry ? (
        <>
          <p>
            {invoice.status === "ISSUED"
              ? "La factura se emitió. Descarga aquí los documentos fiscales."
              : invoice.status === "PROCESSING" || invoice.status === "REQUESTED"
                ? "La solicitud está en proceso. No vuelvas a enviarla mientras se concilia con el proveedor."
                : invoice.status === "FAILED"
                  ? "La solicitud requiere revisión manual. No la vuelvas a enviar para evitar duplicados."
                  : "La factura ya no está disponible."}
          </p>
          {invoice.status === "ISSUED" && (
            <div className="invoice-download-links">
              <a className="button-secondary" href={documentUrl(orderNumber, "pdf", accessToken)}>Descargar PDF</a>
              <a className="button-secondary" href={documentUrl(orderNumber, "xml", accessToken)}>Descargar XML</a>
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            {allowRetry
              ? "Facturama rechazó la solicitud anterior. Corrige cualquier dato fiscal y vuelve a intentarlo."
              : "Solicítala una vez confirmado el pago. Usa exactamente los datos y claves que aparecen en tu constancia fiscal."}
          </p>
          <form className="invoice-request-form" onSubmit={submit}>
            {requiresGuestEmail && (
              <label>
                Correo usado en la compra
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            )}
            <label>
              RFC
              <input
                autoComplete="off"
                maxLength={13}
                pattern="[A-Za-zÑñ&]{3,4}[0-9]{6}[A-Za-z0-9]{3}"
                value={rfc}
                onChange={(event) => setRfc(event.target.value.toLocaleUpperCase("es-MX"))}
                required
              />
            </label>
            <label>
              Razón social o nombre fiscal
              <input autoComplete="organization" maxLength={254} value={legalName} onChange={(event) => setLegalName(event.target.value)} required />
            </label>
            <label>
              Régimen fiscal (clave SAT)
              <input inputMode="numeric" maxLength={3} pattern="[0-9]{3}" value={taxRegime} onChange={(event) => setTaxRegime(event.target.value)} required />
            </label>
            <label>
              Código postal fiscal
              <input inputMode="numeric" autoComplete="postal-code" maxLength={5} pattern="[0-9]{5}" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} required />
            </label>
            <label>
              Uso de CFDI (clave SAT)
              <input autoCapitalize="characters" maxLength={3} pattern="[A-Za-z][0-9]{2}" value={cfdiUse} onChange={(event) => setCfdiUse(event.target.value.toLocaleUpperCase("es-MX"))} required />
            </label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button className="button-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Emitiendo CFDI…" : allowRetry ? "Reintentar solicitud" : "Solicitar factura"} <span aria-hidden="true">→</span>
            </button>
          </form>
          <small>Los datos fiscales se enviarán a Facturama para emitir el CFDI. Revisa cada campo antes de confirmar; por orden solo se permite una solicitud.</small>
        </>
      )}
    </section>
  );
}
