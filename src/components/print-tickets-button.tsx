"use client";

export default function PrintTicketsButton() {
  return (
    <button className="button-primary ticket-print-button" type="button" onClick={() => window.print()}>
      Imprimir o guardar como PDF <span aria-hidden="true">↓</span>
    </button>
  );
}
