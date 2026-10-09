import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  processPendingTicketEmails,
  TicketEmailConfigurationError,
} from "@/lib/ticket-emails";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || Buffer.byteLength(secret) < 32 || !authorization) return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;
  const provided = Buffer.from(authorization.slice(prefix.length));
  const configured = Buffer.from(secret);
  return (
    provided.length === configured.length &&
    timingSafeEqual(configured, provided)
  );
}

async function processQueue(request: Request) {
  if (!isAuthorized(request)) {
    const secret = process.env.CRON_SECRET;
    if (!secret || Buffer.byteLength(secret) < 32) {
      console.error("Falta configurar CRON_SECRET para reintentar correos de boletos.");
      return NextResponse.json(
        { error: "El proceso de correos no está configurado." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const result = await processPendingTicketEmails();
    return NextResponse.json(result);
  } catch (error) {
    console.error("No se pudo procesar la cola de correos de boletos.");
    if (error instanceof TicketEmailConfigurationError) {
      return NextResponse.json(
        { error: "El servicio de correo aún no está configurado." },
        { status: 503 },
      );
    }
    throw error;
  }
}

export const GET = processQueue;
export const POST = processQueue;
