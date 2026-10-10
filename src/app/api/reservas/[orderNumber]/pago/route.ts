import {
  EventStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
} from "@prisma/client";
import { NextResponse } from "next/server";
import {
  createMercadoPagoPreference,
  isMercadoPagoCheckoutUrl,
  MercadoPagoHttpError,
  MercadoPagoResponseError,
} from "@/lib/mercado-pago";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type PaymentRouteProps = {
  params: Promise<{ orderNumber: string }>;
};

class ReservationNoLongerActiveError extends Error {
  constructor() {
    super("La reserva venció. Regresa al evento para elegir boletos disponibles.");
    this.name = "ReservationNoLongerActiveError";
  }
}

function truncateTitle(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join("");
}

function isOpenOrderStatus(status: OrderStatus) {
  return (
    status === OrderStatus.PENDING || status === OrderStatus.PAYMENT_PENDING
  );
}

export async function POST(_request: Request, { params }: PaymentRouteProps) {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;
  const checkoutMode =
    process.env.MERCADO_PAGO_CHECKOUT_MODE ??
    (process.env.NODE_ENV === "production" ? "production" : "sandbox");

  if (!accessToken || !webhookSecret || !appUrl) {
    return NextResponse.json(
      { error: "El pago en línea aún no está configurado." },
      { status: 503 },
    );
  }

  if (checkoutMode !== "sandbox" && checkoutMode !== "production") {
    console.error("MERCADO_PAGO_CHECKOUT_MODE debe ser sandbox o production.");
    return NextResponse.json(
      { error: "El pago en línea aún no está configurado." },
      { status: 503 },
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(appUrl);
  } catch (error) {
    if (error instanceof TypeError) {
      console.error("APP_URL no contiene una URL válida.");
      return NextResponse.json(
        { error: "El pago en línea no está disponible en este momento." },
        { status: 503 },
      );
    }
    throw error;
  }

  if (
    (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") ||
    !["http:", "https:"].includes(baseUrl.protocol)
  ) {
    console.error("APP_URL debe usar HTTPS en producción.");
    return NextResponse.json(
      { error: "El pago en línea no está disponible en este momento." },
      { status: 503 },
    );
  }

  const { orderNumber } = await params;
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      guestEmail: true,
      status: true,
      reservationEndsAt: true,
      subtotalCents: true,
      serviceFeeCents: true,
      taxCents: true,
      totalCents: true,
      items: {
        select: {
          quantity: true,
          unitPriceCents: true,
          event: { select: { title: true, status: true } },
          ticketZone: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "No encontramos esa reserva." }, { status: 404 });
  }

  const now = new Date();
  if (
    !isOpenOrderStatus(order.status) ||
    !order.reservationEndsAt ||
    order.reservationEndsAt <= now ||
    order.items.some((item) => item.event.status !== EventStatus.PUBLISHED)
  ) {
    return NextResponse.json(
      { error: "La reserva venció. Regresa al evento para elegir boletos disponibles." },
      { status: 409 },
    );
  }

  const preferenceIdempotencyKey = `boleta-pref-${order.id}-${checkoutMode}`;
  const existingPreference = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      provider: PaymentProvider.MERCADO_PAGO,
      idempotencyKey: preferenceIdempotencyKey,
      providerPreferenceId: { not: null },
      checkoutUrl: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { checkoutUrl: true },
  });

  if (existingPreference?.checkoutUrl && isMercadoPagoCheckoutUrl(existingPreference.checkoutUrl)) {
    return NextResponse.json({ checkoutUrl: existingPreference.checkoutUrl });
  }

  const preferencePayment = await prisma.payment.upsert({
    where: { idempotencyKey: preferenceIdempotencyKey },
    create: {
      orderId: order.id,
      provider: PaymentProvider.MERCADO_PAGO,
      status: PaymentStatus.PENDING,
      amountCents: order.totalCents,
      currency: "MXN",
      idempotencyKey: preferenceIdempotencyKey,
      expiresAt: order.reservationEndsAt,
    },
    update: {},
    select: { id: true },
  });

  const backUrl = `${baseUrl.origin}/checkout/${encodeURIComponent(order.orderNumber)}`;
  const preferenceItems = order.items.map((item) => ({
    id: item.ticketZone.id,
    title: truncateTitle(`${item.event.title} — ${item.ticketZone.name}`, 250),
    quantity: item.quantity,
    unit_price: item.unitPriceCents / 100,
    currency_id: "MXN",
  }));

  if (order.taxCents > 0) {
    preferenceItems.push({
      id: "IVA-16",
      title: "IVA (16%)",
      quantity: 1,
      unit_price: order.taxCents / 100,
      currency_id: "MXN",
    });
  }
  if (order.serviceFeeCents > 0) {
    preferenceItems.push({
      id: "cargo-servicio",
      title: "Cargo de servicio",
      quantity: 1,
      unit_price: order.serviceFeeCents / 100,
      currency_id: "MXN",
    });
  }

  let preference;
  try {
    preference = await createMercadoPagoPreference(
      accessToken,
      preferenceIdempotencyKey,
      {
        items: preferenceItems,
        payer: { email: order.guestEmail },
        external_reference: order.orderNumber,
        notification_url: `${baseUrl.origin}/api/pagos/webhook`,
        back_urls: {
          success: `${backUrl}?resultado=exito`,
          failure: `${backUrl}?resultado=fallido`,
          pending: `${backUrl}?resultado=pendiente`,
        },
        auto_return: "approved",
        expires: true,
        expiration_date_from: now.toISOString(),
        expiration_date_to: order.reservationEndsAt.toISOString(),
        payment_methods: {
          installments: 12,
          excluded_payment_types: [{ id: "ticket" }, { id: "bank_transfer" }],
        },
        metadata: {
          order_number: order.orderNumber,
          reservation_expires_at: order.reservationEndsAt.toISOString(),
        },
        statement_descriptor: "BOLETA",
      },
    );
  } catch (error) {
    if (
      error instanceof MercadoPagoHttpError ||
      error instanceof MercadoPagoResponseError
    ) {
      return NextResponse.json(
        { error: "No pudimos iniciar el pago con Mercado Pago. Intenta de nuevo." },
        { status: 502 },
      );
    }
    throw error;
  }

  const checkoutUrl =
    checkoutMode === "sandbox"
      ? preference.sandbox_init_point
      : preference.init_point;

  if (!checkoutUrl || !isMercadoPagoCheckoutUrl(checkoutUrl)) {
    console.error(`Mercado Pago no devolvió una URL de checkout ${checkoutMode} válida.`);
    return NextResponse.json(
      { error: "No pudimos iniciar el pago con Mercado Pago. Intenta de nuevo." },
      { status: 502 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
        select: { status: true, reservationEndsAt: true },
      });

      if (
        !currentOrder ||
        !isOpenOrderStatus(currentOrder.status) ||
        !currentOrder.reservationEndsAt ||
        currentOrder.reservationEndsAt <= new Date()
      ) {
        throw new ReservationNoLongerActiveError();
      }

      await tx.payment.update({
        where: { id: preferencePayment.id },
        data: {
          providerPreferenceId: preference.id,
          checkoutUrl,
        },
      });

      if (currentOrder.status === OrderStatus.PENDING) {
        const transitioned = await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.PENDING,
            reservationEndsAt: { gt: new Date() },
          },
          data: { status: OrderStatus.PAYMENT_PENDING },
        });
        if (transitioned.count !== 1) throw new ReservationNoLongerActiveError();
      }
    });
  } catch (error) {
    if (error instanceof ReservationNoLongerActiveError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ checkoutUrl });
}
