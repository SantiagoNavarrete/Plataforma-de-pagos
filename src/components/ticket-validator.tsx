"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

type ValidationResponse = {
  status?: "VALIDATED";
  ticket?: {
    event: string;
    startsAt: string;
    timeZone: string;
    venue: string;
    city: string;
    zone: string;
    orderNumber: string;
  };
  error?: string;
  checkedInAt?: string | null;
};

function formatDate(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(date));
}

export default function TicketValidator() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const requestInProgressRef = useRef(false);
  const [staffKey, setStaffKey] = useState("");
  const [code, setCode] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState<ValidationResponse | null>(null);

  useEffect(
    () => () => {
      controlsRef.current?.stop();
    },
    [],
  );

  async function validateTicket(ticketCode: string) {
    if (requestInProgressRef.current) return;
    requestInProgressRef.current = true;
    setIsValidating(true);
    setMessage("");
    setValidation(null);

    try {
      const response = await fetch("/api/validar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${staffKey}`,
        },
        body: JSON.stringify({ code: ticketCode }),
      });
      const result: ValidationResponse = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "No se pudo validar el boleto.");
        setValidation(result);
        return;
      }
      setValidation(result);
      setCode("");
    } catch {
      setMessage("No pudimos conectar con el servicio de validación. Intenta de nuevo.");
    } finally {
      requestInProgressRef.current = false;
      setIsValidating(false);
    }
  }

  async function startScanner() {
    if (!staffKey) {
      setMessage("Ingresa la clave del personal para iniciar el escáner.");
      return;
    }
    if (!videoRef.current) return;

    setMessage("");
    try {
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        },
        videoRef.current,
        (result) => {
          const scannedCode = result?.getText();
          if (!scannedCode || requestInProgressRef.current) return;
          controlsRef.current?.stop();
          controlsRef.current = null;
          setIsScanning(false);
          setCode(scannedCode);
          void validateTicket(scannedCode);
        },
      );
      controlsRef.current = controls;
      setIsScanning(true);
    } catch (error) {
      setIsScanning(false);
      setMessage(
        error instanceof Error
          ? `No pudimos iniciar la cámara: ${error.message}`
          : "No pudimos iniciar la cámara.",
      );
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setIsScanning(false);
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) {
      setMessage("Escanea o escribe el código del boleto.");
      return;
    }
    stopScanner();
    void validateTicket(code.trim());
  }

  return (
    <main className="ticket-portal-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <span className="checkout-secure-label">VALIDACIÓN DE ACCESO</span>
      </header>

      <section className="ticket-validator">
        <span className="section-kicker">HERRAMIENTA PARA PERSONAL</span>
        <h1>Validar <span>boleto.</span></h1>
        <p>Escanea el QR. Cada boleto puede usarse una sola vez.</p>

        <label className="ticket-form-field">
          Clave del personal
          <input
            type="password"
            autoComplete="off"
            value={staffKey}
            onChange={(event) => setStaffKey(event.target.value)}
            aria-describedby="validation-key-help"
          />
        </label>
        <span id="validation-key-help" className="ticket-help">
          La clave se usa solo durante esta sesión y no se guarda en el navegador.
        </span>

        <div className="ticket-scanner">
          <video
            ref={videoRef}
            className={isScanning ? "ticket-scanner-video ticket-scanner-video--active" : "ticket-scanner-video"}
            muted
            playsInline
            aria-label="Vista de la cámara para escanear un código QR"
          />
          {isScanning && <span className="ticket-scanner-frame" aria-hidden="true" />}
        </div>
        <div className="ticket-scanner-actions">
          {!isScanning ? (
            <button className="button-primary" type="button" onClick={startScanner}>
              Abrir cámara <span aria-hidden="true">▣</span>
            </button>
          ) : (
            <button className="button-secondary" type="button" onClick={stopScanner}>
              Cerrar cámara
            </button>
          )}
        </div>

        <form className="ticket-code-form" onSubmit={submitCode}>
          <label className="ticket-form-field">
            Código QR manual
            <input
              type="text"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Pega o escribe el código"
            />
          </label>
          <button className="button-primary" type="submit" disabled={isValidating}>
            {isValidating ? "Validando..." : "Validar boleto"}
          </button>
        </form>

        {message && (
          <p className="ticket-validation-message ticket-validation-message--error" role="alert">
            {message}
          </p>
        )}
        {validation?.status === "VALIDATED" && validation.ticket && (
          <section className="ticket-validation-result ticket-validation-result--valid" aria-live="polite">
            <strong>Boleto válido · Acceso registrado</strong>
            <p>{validation.ticket.event}</p>
            <p>{validation.ticket.zone} · {formatDate(validation.ticket.startsAt, validation.ticket.timeZone)}</p>
            <p>{validation.ticket.venue} · {validation.ticket.city}</p>
            <small>Orden {validation.ticket.orderNumber}</small>
          </section>
        )}
        {validation?.error && (
          <section className="ticket-validation-result ticket-validation-result--invalid" aria-live="polite">
            <strong>{validation.error}</strong>
            {validation.checkedInAt && (
              <p>Primer acceso registrado: {formatDate(validation.checkedInAt, "America/Mexico_City")}</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
