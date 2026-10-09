import {
  TicketEmailStatus,
  OrderStatus,
} from "@prisma/client";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import {
  createOrderAccessToken,
  createTicketCode,
  getTicketSecret,
} from "@/lib/tickets";
import { prisma } from "@/lib/prisma";

const MAX_DELIVERY_ATTEMPTS = 10;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

export class TicketEmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketEmailConfigurationError";
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function requiredEmailConfiguration() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  const appUrl = process.env.APP_URL;

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !user ||
    !password ||
    !from ||
    !appUrl
  ) {
    throw new TicketEmailConfigurationError(
      "Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM y APP_URL.",
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(appUrl);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TicketEmailConfigurationError("APP_URL debe contener una URL válida.");
    }
    throw error;
  }
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:")
  ) {
    throw new TicketEmailConfigurationError(
      "APP_URL debe usar HTTPS en producción para enviar el acceso a los boletos.",
    );
  }

  return { host, port, user, password, from, baseUrl };
}

function formatEventDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

async function deliverTicketEmail(deliveryId: string) {
  const secret = getTicketSecret();
  const {
    host,
    port,
    user,
    password,
    from,
    baseUrl,
  } = requiredEmailConfiguration();
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);

  const claimed = await prisma.ticketEmailDelivery.updateMany({
    where: {
      id: deliveryId,
      OR: [
        { status: TicketEmailStatus.PENDING },
        {
          status: TicketEmailStatus.FAILED,
          attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        },
        {
          status: TicketEmailStatus.PROCESSING,
          updatedAt: { lt: staleProcessingBefore },
        },
      ],
    },
    data: {
      status: TicketEmailStatus.PROCESSING,
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  if (claimed.count !== 1) return false;

  const delivery = await prisma.ticketEmailDelivery.findUniqueOrThrow({
    where: { id: deliveryId },
    select: {
      attempts: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          guestEmail: true,
          status: true,
          tickets: {
            orderBy: [{ orderItemId: "asc" }, { sequence: "asc" }],
            select: {
              id: true,
              sequence: true,
              orderItem: {
                select: {
                  event: {
                    select: {
                      title: true,
                      startsAt: true,
                      timeZone: true,
                      venue: { select: { name: true, city: true } },
                    },
                  },
                },
              },
              ticketZone: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  try {
    if (
      delivery.order.status !== OrderStatus.CONFIRMED &&
      delivery.order.status !== OrderStatus.PARTIALLY_REFUNDED
    ) {
      throw new Error("La orden no está confirmada para enviar boletos.");
    }
    if (delivery.order.tickets.length === 0) {
      throw new Error("La orden confirmada no tiene boletos emitidos.");
    }

    const ticketPage = new URL(
      `/mis-boletos/${encodeURIComponent(delivery.order.orderNumber)}`,
      baseUrl,
    );
    ticketPage.searchParams.set(
      "token",
      createOrderAccessToken(delivery.order.id, secret),
    );

    const attachments = await Promise.all(
      delivery.order.tickets.map(async (ticket) => ({
        filename: `boleto-${ticket.sequence}.png`,
        content: await QRCode.toBuffer(createTicketCode(ticket.id, secret), {
          type: "png",
          errorCorrectionLevel: "M",
          width: 360,
          margin: 2,
        }),
        contentType: "image/png",
        cid: `ticket-${ticket.id}@boleta`,
        contentDisposition: "inline" as const,
      })),
    );

    const ticketCards = delivery.order.tickets.map((ticket) => {
      const event = ticket.orderItem.event;
      return `
        <section style="margin:24px 0;padding:20px;border:1px solid #e8e6e0;border-radius:8px">
          <h2 style="margin:0 0 8px;color:#23251f;font-size:18px">${escapeHtml(event.title)}</h2>
          <p style="margin:4px 0;color:#55574f">${escapeHtml(ticket.ticketZone.name)} · ${escapeHtml(formatEventDate(event.startsAt, event.timeZone))}</p>
          <p style="margin:4px 0;color:#55574f">${escapeHtml(event.venue.name)} · ${escapeHtml(event.venue.city)}</p>
          <img src="cid:ticket-${ticket.id}@boleta" width="220" height="220" alt="Código QR único del boleto ${ticket.sequence}" />
          <p style="margin:4px 0;color:#73746d;font-size:12px">Boleto ${ticket.sequence} · Orden ${escapeHtml(delivery.order.orderNumber)}</p>
        </section>`;
    });

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: { user, pass: password },
    });

    try {
      await transporter.sendMail({
        from,
        to: delivery.order.guestEmail,
        subject: `Tus boletos digitales · Orden ${delivery.order.orderNumber}`,
        text: [
          "¡Tu pago fue confirmado!",
          `Consulta y descarga tus boletos en: ${ticketPage.toString()}`,
          ...delivery.order.tickets.map((ticket) => {
            const event = ticket.orderItem.event;
            return `${event.title} — ${ticket.ticketZone.name}, ${formatEventDate(event.startsAt, event.timeZone)} — ${event.venue.name}, ${event.venue.city}`;
          }),
        ].join("\n\n"),
        html: `
          <div style="max-width:640px;margin:0 auto;padding:24px;background:#fbfaf8;color:#23251f;font-family:Arial,sans-serif">
            <h1 style="font-size:26px">¡Tus boletos están listos!</h1>
            <p>El pago de la orden <strong>${escapeHtml(delivery.order.orderNumber)}</strong> fue confirmado.</p>
            <p><a href="${escapeHtml(ticketPage.toString())}" style="display:inline-block;padding:14px 20px;background:#23251f;color:#fff;text-decoration:none">Ver mis boletos</a></p>
            ${ticketCards.join("")}
            <p style="color:#73746d;font-size:12px">Presenta un código QR distinto por persona. Cada boleto se valida una sola vez en el acceso.</p>
          </div>`,
        attachments,
      });
    } finally {
      transporter.close();
    }

    await prisma.ticketEmailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: TicketEmailStatus.SENT,
        sentAt: new Date(),
        lastError: null,
      },
    });
    return true;
  } catch {
    await prisma.ticketEmailDelivery.update({
      where: { id: deliveryId },
      data: {
        status:
          delivery.attempts >= MAX_DELIVERY_ATTEMPTS
            ? TicketEmailStatus.FAILED
            : TicketEmailStatus.PENDING,
        lastError: "No se pudo enviar el correo; revisa la configuración SMTP.",
      },
    });
    console.error("No se pudo enviar el correo de boletos.", {
      deliveryId,
      attempt: delivery.attempts,
    });
    return false;
  }
}

export async function sendTicketEmailForOrder(orderId: string) {
  const delivery = await prisma.ticketEmailDelivery.findUnique({
    where: { orderId },
    select: { id: true },
  });
  if (!delivery) return false;
  return deliverTicketEmail(delivery.id);
}

export async function processPendingTicketEmails(limit = 25) {
  requiredEmailConfiguration();
  try {
    getTicketSecret();
  } catch (error) {
    if (error instanceof Error) {
      throw new TicketEmailConfigurationError(error.message);
    }
    throw error;
  }
  const staleProcessingBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  const deliveries = await prisma.ticketEmailDelivery.findMany({
    where: {
      OR: [
        { status: TicketEmailStatus.PENDING },
        {
          status: TicketEmailStatus.FAILED,
          attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        },
        {
          status: TicketEmailStatus.PROCESSING,
          updatedAt: { lt: staleProcessingBefore },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(Math.trunc(limit), 1), 100),
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    try {
      if (await deliverTicketEmail(delivery.id)) sent += 1;
      else failed += 1;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error("No se pudo procesar el envío de boletos.");
    }
  }
  return { processed: deliveries.length, sent, failed };
}
