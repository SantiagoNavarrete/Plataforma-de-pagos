import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  TicketStatus,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getMercadoPagoPayment,
  MercadoPagoHttpError,
  MercadoPagoRefundError,
  MercadoPagoResponseError,
  refundMercadoPagoPayment,
  verifyMercadoPagoSignature,
} from "@/lib/mercado-pago";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/reservations";
import { sendTicketEmailForOrder } from "@/lib/ticket-emails";
import { getTicketSecret, issueTicketsForConfirmedOrder } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const webhookSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  type: z.string().optional(),
  action: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]).optional() }).optional(),
});

const terminalPaymentStatuses: Record<string, PaymentStatus> = {
  approved: PaymentStatus.PAID,
  authorized: PaymentStatus.AUTHORIZED,
  in_process: PaymentStatus.PROCESSING,
  pending: PaymentStatus.PENDING,
  rejected: PaymentStatus.FAILED,
  cancelled: PaymentStatus.FAILED,
  refunded: PaymentStatus.REFUNDED,
  charged_back: PaymentStatus.REFUNDED,
};

function paymentMethodFromType(type: string | null | undefined) {
  switch (type) {
    case "credit_card":
      return "CREDIT_CARD" as const;
    case "debit_card":
      return "DEBIT_CARD" as const;
    case "account_money":
    case "digital_wallet":
      return "WALLET" as const;
    case "ticket":
      return "OXXO" as const;
    case "bank_transfer":
      return "SPEI" as const;
    default:
      return null;
  }
}

function isAllowedOnlineMethod(method: ReturnType<typeof paymentMethodFromType>) {
  return (
    method === "CREDIT_CARD" ||
    method === "DEBIT_CARD" ||
    method === "WALLET"
  );
}

class PaymentDataMismatchError extends Error {
  constructor() {
    super("El pago recibido no coincide con la orden pendiente.");
    this.name = "PaymentDataMismatchError";
  }
}

class ReservationNoLongerActiveError extends Error {
  constructor() {
    super("La reserva venció antes de confirmar el pago.");
    this.name = "ReservationNoLongerActiveError";
  }
}

type WebhookResult = {
  duplicate: boolean;
  requiresRefund: boolean;
  paymentId: string;
};

export async function POST(request: Request) {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!accessToken || !webhookSecret) {
    console.error("Faltan credenciales para validar o procesar el webhook de Mercado Pago.");
    return NextResponse.json(
      { error: "El webhook de pagos no está configurado." },
      { status: 503 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "La notificación no contiene JSON válido." }, { status: 400 });
    }
    throw error;
  }

  const parsedWebhook = webhookSchema.safeParse(rawBody);
  if (!parsedWebhook.success) {
    return NextResponse.json({ error: "La notificación de pago no es válida." }, { status: 400 });
  }

  const requestId = request.headers.get("x-request-id");
  const signature = request.headers.get("x-signature");
  const url = new URL(request.url);
  const queryPaymentId = url.searchParams.get("data.id");
  const bodyPaymentId = parsedWebhook.data.data?.id?.toString();
  const paymentId = queryPaymentId ?? bodyPaymentId;

  if (
    !requestId ||
    !signature ||
    !paymentId ||
    paymentId.length > 200 ||
    (queryPaymentId && bodyPaymentId && queryPaymentId !== bodyPaymentId)
  ) {
    return NextResponse.json({ error: "La notificación no incluye una firma válida." }, { status: 401 });
  }

  if (
    !verifyMercadoPagoSignature({
      dataId: paymentId,
      requestId,
      signature,
      secret: webhookSecret,
    })
  ) {
    return NextResponse.json({ error: "La firma de la notificación no es válida." }, { status: 401 });
  }

  const notificationType =
    parsedWebhook.data.type ?? parsedWebhook.data.action?.split(".")[0];
  if (notificationType !== "payment") {
    return NextResponse.json({ received: true });
  }

  const providerEventId =
    parsedWebhook.data.id?.toString() ?? `${requestId}:${paymentId}`;
  const existingReceipt = await prisma.webhookReceipt.findUnique({
    where: {
      provider_providerEventId: {
        provider: PaymentProvider.MERCADO_PAGO,
        providerEventId,
      },
    },
    select: { processedAt: true },
  });

  if (existingReceipt?.processedAt) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  let providerPayment;
  try {
    providerPayment = await getMercadoPagoPayment(accessToken, paymentId);
  } catch (error) {
    if (error instanceof MercadoPagoHttpError || error instanceof MercadoPagoResponseError) {
      return NextResponse.json(
        { error: "No pudimos verificar el estado del pago con Mercado Pago." },
        { status: 502 },
      );
    }
    throw error;
  }

  if (providerPayment.id !== paymentId || !providerPayment.external_reference) {
    return NextResponse.json({ error: "El pago no está asociado a una orden." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber: providerPayment.external_reference },
    select: {
      id: true,
      orderNumber: true,
      guestEmail: true,
      status: true,
      reservationEndsAt: true,
      totalCents: true,
      items: {
        select: {
          eventId: true,
          ticketZoneId: true,
          quantity: true,
        },
      },
    },
  });

  if (
    !order ||
    providerPayment.currency_id !== "MXN" ||
    Math.round(providerPayment.transaction_amount * 100) !== order.totalCents ||
    !providerPayment.preference_id
  ) {
    console.error("Mercado Pago envió un pago que no coincide con el importe o la orden.");
    return NextResponse.json({ error: "El importe del pago no coincide con la orden." }, { status: 400 });
  }

  const preference = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: PaymentProvider.MERCADO_PAGO,
      providerPreferenceId: providerPayment.preference_id,
      checkoutUrl: { not: null },
    },
    select: { id: true },
  });

  if (!preference) {
    console.error("El pago de Mercado Pago no coincide con una preferencia de Boleta.");
    return NextResponse.json({ error: "No pudimos vincular el pago con su reserva." }, { status: 400 });
  }

  const mappedStatus = terminalPaymentStatuses[providerPayment.status];
  if (!mappedStatus) {
    console.error("Mercado Pago devolvió un estado de pago no reconocido.", {
      status: providerPayment.status,
    });
    return NextResponse.json({ error: "El estado del pago no es compatible." }, { status: 422 });
  }

  const paymentMethod = paymentMethodFromType(providerPayment.payment_type_id);
  const amountRefundedCents = Math.round(
    (providerPayment.transaction_amount_refunded ?? 0) * 100,
  );
  const paymentStatus =
    mappedStatus === PaymentStatus.REFUNDED &&
    amountRefundedCents > 0 &&
    amountRefundedCents < order.totalCents
      ? PaymentStatus.PARTIALLY_REFUNDED
      : mappedStatus;
  const isSuccessful = paymentStatus === PaymentStatus.PAID;
  const requiresRefund =
    isSuccessful && !isAllowedOnlineMethod(paymentMethod);
  if (isSuccessful && !requiresRefund) {
    try {
      getTicketSecret();
    } catch {
      console.error("No se pueden emitir boletos: falta configurar TICKET_QR_SECRET.");
      return NextResponse.json(
        { error: "La emisión de boletos no está disponible en este momento." },
        { status: 503 },
      );
    }
  }

  try {
    const result: WebhookResult = await prisma.$transaction(async (tx) => {
      await releaseExpiredReservations(tx);

      const previousReceipt = await tx.webhookReceipt.findUnique({
        where: {
          provider_providerEventId: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerEventId,
          },
        },
        select: { id: true, processedAt: true },
      });

      if (previousReceipt?.processedAt) {
        return { duplicate: true, requiresRefund: false, paymentId };
      }

      const paymentData = {
        orderId: order.id,
        provider: PaymentProvider.MERCADO_PAGO,
        method: paymentMethod,
        status: paymentStatus,
        amountCents: Math.round(providerPayment.transaction_amount * 100),
        currency: providerPayment.currency_id,
        providerPaymentId: providerPayment.id,
        providerPreferenceId: providerPayment.preference_id,
        idempotencyKey: `boleta-payment-${providerPayment.id}`,
        expiresAt: order.reservationEndsAt,
      };

      const previousPayment = await tx.payment.findUnique({
        where: {
          provider_providerPaymentId: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerPaymentId: providerPayment.id,
          },
        },
        select: { id: true, status: true },
      });
      const payment = await tx.payment.upsert({
        where: {
          provider_providerPaymentId: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerPaymentId: providerPayment.id,
          },
        },
        create: paymentData,
        update: {
          method: paymentMethod,
          status: paymentStatus,
        },
        select: { id: true, status: true },
      });

      if (previousReceipt) {
        await tx.webhookReceipt.update({
          where: { id: previousReceipt.id },
          data: { paymentId: payment.id, signatureValid: true },
        });
      } else {
        await tx.webhookReceipt.create({
          data: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerEventId,
            paymentId: payment.id,
            eventType: parsedWebhook.data.action ?? notificationType,
            signatureValid: true,
          },
        });
      }

      if (requiresRefund) {
        return { duplicate: false, requiresRefund: true, paymentId };
      }

      if (isSuccessful) {
        if (
          order.status === OrderStatus.CONFIRMED ||
          order.status === OrderStatus.REFUNDED ||
          order.status === OrderStatus.PARTIALLY_REFUNDED
        ) {
          const alreadyConfirmed =
            order.status === OrderStatus.CONFIRMED &&
            previousPayment?.status === PaymentStatus.PAID;
          const receipt = await tx.webhookReceipt.findUniqueOrThrow({
            where: {
              provider_providerEventId: {
                provider: PaymentProvider.MERCADO_PAGO,
                providerEventId,
              },
            },
          });
          if (alreadyConfirmed) {
            await issueTicketsForConfirmedOrder(tx, order.id);
            await tx.webhookReceipt.update({
              where: { id: receipt.id },
              data: { processedAt: new Date() },
            });
          }
          return {
            duplicate: false,
            requiresRefund: !alreadyConfirmed,
            paymentId,
          };
        }

        const eventIds = [...new Set(order.items.map((item) => item.eventId))].sort();
        if (eventIds.length === 0) {
          return { duplicate: false, requiresRefund: true, paymentId };
        }
        const availableEvents = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"::text AS id
            FROM "Event"
            WHERE "id" IN (${Prisma.join(
              eventIds.map((eventId) => Prisma.sql`${eventId}::uuid`),
            )})
              AND "status" = 'PUBLISHED'
              AND "startsAt" > CURRENT_TIMESTAMP
            FOR SHARE
          `,
        );
        if (availableEvents.length !== eventIds.length) {
          return { duplicate: false, requiresRefund: true, paymentId };
        }

        const now = new Date();
        const confirmed = await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.PAYMENT_PENDING,
            reservationEndsAt: { gt: now },
          },
          data: { status: OrderStatus.CONFIRMED },
        });

        if (confirmed.count !== 1) {
          return { duplicate: false, requiresRefund: true, paymentId };
        }

        const sortedItems = [...order.items].sort((left, right) =>
          left.ticketZoneId.localeCompare(right.ticketZoneId),
        );
        for (const item of sortedItems) {
          const buyerLimit = await tx.eventBuyerLimit.updateMany({
            where: {
              eventId: item.eventId,
              email: order.guestEmail,
              ticketsReserved: { gte: item.quantity },
            },
            data: {
              ticketsReserved: { decrement: item.quantity },
              ticketsSold: { increment: item.quantity },
            },
          });
          if (buyerLimit.count !== 1) throw new ReservationNoLongerActiveError();

          const zone = await tx.ticketZone.updateMany({
            where: {
              id: item.ticketZoneId,
              inventoryReserved: { gte: item.quantity },
            },
            data: {
              inventoryReserved: { decrement: item.quantity },
              inventorySold: { increment: item.quantity },
            },
          });
          if (zone.count !== 1) throw new ReservationNoLongerActiveError();
        }
        await issueTicketsForConfirmedOrder(tx, order.id);
      } else if (
        paymentStatus === PaymentStatus.REFUNDED ||
        paymentStatus === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.CONFIRMED,
          },
          data: {
            status:
              paymentStatus === PaymentStatus.REFUNDED
                ? OrderStatus.REFUNDED
                : OrderStatus.PARTIALLY_REFUNDED,
          },
        });
        if (paymentStatus === PaymentStatus.REFUNDED) {
          await tx.ticket.updateMany({
            where: {
              orderId: order.id,
              status: TicketStatus.VALID,
            },
            data: { status: "REFUNDED" },
          });
        }
      }

      const receipt = await tx.webhookReceipt.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerEventId,
          },
        },
      });
      await tx.webhookReceipt.update({
        where: { id: receipt.id },
        data: { processedAt: new Date() },
      });

      return { duplicate: false, requiresRefund: false, paymentId };
    });

    if (result.requiresRefund) {
      await refundMercadoPagoPayment(accessToken, result.paymentId);
      await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: {
            provider_providerPaymentId: {
              provider: PaymentProvider.MERCADO_PAGO,
              providerPaymentId: result.paymentId,
            },
          },
          select: { id: true },
        });
        if (!payment) {
          throw new PaymentDataMismatchError();
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });
        await tx.webhookReceipt.update({
          where: {
            provider_providerEventId: {
              provider: PaymentProvider.MERCADO_PAGO,
              providerEventId,
            },
          },
          data: { processedAt: new Date(), paymentId: payment.id },
        });
      });
    }

    if (isSuccessful && !result.requiresRefund) {
      try {
        await sendTicketEmailForOrder(order.id);
      } catch {
        console.error("El correo de boletos quedó pendiente de reintento.", {
          orderNumber: order.orderNumber,
        });
      }
    }

    return NextResponse.json({
      received: true,
      duplicate: result.duplicate,
      refunded: result.requiresRefund,
    });
  } catch (error) {
    if (error instanceof PaymentDataMismatchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ReservationNoLongerActiveError) {
      console.error("La reserva no pudo conservar el inventario al confirmar el pago.");
      return NextResponse.json(
        { error: "No pudimos confirmar el inventario del pago." },
        { status: 409 },
      );
    }
    if (error instanceof MercadoPagoRefundError) {
      return NextResponse.json(
        { error: "El pago tardío requiere un reembolso que sigue pendiente." },
        { status: 502 },
      );
    }
    if (error instanceof MercadoPagoHttpError || error instanceof MercadoPagoResponseError) {
      return NextResponse.json(
        { error: "No pudimos verificar el estado del pago." },
        { status: 502 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const committedReceipt = await prisma.webhookReceipt.findUnique({
        where: {
          provider_providerEventId: {
            provider: PaymentProvider.MERCADO_PAGO,
            providerEventId,
          },
        },
        select: { processedAt: true },
      });
      if (committedReceipt?.processedAt) {
        return NextResponse.json({ received: true, duplicate: true });
      }
    }
    throw error;
  }
}
