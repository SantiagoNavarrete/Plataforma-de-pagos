import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Boleta — Encuentra tu próximo plan",
    template: "%s — Boleta",
  },
  description:
    "Compra boletos para conciertos, teatro, deportes y festivales en México. Encuentra tu próximo plan en Boleta.",
  applicationName: "Boleta",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Boleta",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbfaf8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-MX" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
