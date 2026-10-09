import {
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticationConfigured } from "@/lib/auth-config";
import {
  buildFacturamaInvoicePayload,
  canRetryFacturamaFailure,
  createFacturamaInvoice,
  FacturamaConfigurationError,
  FacturamaHttpError,
  FacturamaNetworkError,
  FacturamaResponseError,
  getFacturamaConfig,
  retryableFacturamaFailureCodes,
} from "@/lib/facturama";
import { isSameOriginRequest } from "@/lib/request-security";
import { prisma } from "@/lib/prisma";
import { getTicketSecret, verifyOrderAccessToken } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const invoiceRequestSchema = z.object({
  orderNumber: z.string().regex(/^BO-[0-9A-F]{28}$/i, "La orden no es válida."),
  accessToken: z.string().max(100).optional(),
  email: z
    .string()
    .trim()
    .email("Escribe el correo usado en la compra.")
    .max(320)
    .transform((email) => email.toLowerCase())
    .optional(),
  rfc: z
    .string()
    .trim()
    .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i, "Revisa el RFC.")
    .transform((value) => value.toLocaleUpperCase("es-MX")),
  legalName: z.string().trim().min(2).max(254),
  taxRegime: z.string().trim().regex(/^\d{3}$/, "Indica la clave de régimen fiscal del SAT."),
  postalCode: z.string().trim().regex(/^\d{5}$/, "El código postal debe tener cinco dígitos."),
  cfdiUse: z
    .string()
    .trim()
    .regex(/^[A-Z]\d{2}$/i, "Indica la clave de uso de CFDI.")
    .transform((value) => value.toLocaleUpperCase("es-MX")),
}).strict();

class InvoiceAccessDeniedError extends Error {}
class InvoiceOrderUnavailableError extends Error {}
class InvoiceAlreadyRequestedError extends Error {
  constructor(readonly status: InvoiceStatus) {
    super("Ya existe una solicitud de factura para esta orden.");
  }
}

function facturamaFailureCode(error: unknown) {
  if (error instanceof FacturamaHttpError) return `FACTURAMA_HTTP_${error.status}`;
  if (error instanceof FacturamaResponseError) return "FACTURAMA_INVALID_RESPONSE";
  return error instanceof FacturamaNetworkError
    ? "FACTURAMA_NETWORK_ERROR"
    : "FACTURAMA_UNKNOWN_ERROR";
}

function isFacturamaRequestError(error: unknown) {
  return (
    error instanceof FacturamaHttpError ||
    error instanceof FacturamaNetworkError ||
    error instanceof FacturamaResponseError
  );
}

async function markInvoiceFailed(
  invoiceId: string,
  orderId: string,
  failureCode: string,
  userId?: string,
) {
  await prisma.$transaction(async (tx) => {
    const failed = await tx.invoice.updateMany({
      where: { id: invoiceId, status: InvoiceStatus.PROCESSING },
      data: { status: InvoiceStatus.FAILED, failureCode },
    });
    if (failed.count === 1) {
      await tx.auditLog.create({
        data: {
          ...(userId ? { userId } : {}),
          orderId,
          action: "INVOICE_REQUEST_FAILED",
          entityType: "Invoice",
          entityId: invoiceId,
          details: { status: InvoiceStatus.FAILED, failureCode },
        },
      });
    }
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "La solicitud no proviene de este sitio." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "La solicitud debe contener JSON válido." }, { status: 400 });
    }
    throw error;
  }

  const parsed = invoiceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos fiscales." },
      { status: 400 },
    );
  }

  let config;
  try {
    config = getFacturamaConfig();
  } catch (error) {
    if (error instanceof FacturamaConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const session = isAuthenticationConfigured()
    ? await (await import("@/lib/auth")).auth.api.getSession({
        headers: request.headers,
      })
    : null;

  let claim: {
    invoiceId: string;
    orderId: string;
    orderNumber: string;
    payload: ReturnType<typeof buildFacturamaInvoicePayload>;
  } | null = null;
  let providerInvoiceId: string | null = null;

  try {
    const claimed = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber: parsed.data.orderNumber },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          guestEmail: true,
          status: true,
          subtotalCents: true,
          taxCents: true,
          serviceFeeCents: true,
          totalCents: true,
          invoice: { select: { id: true, status: true, failureCode: true } },
          payments: {
            where: { status: PaymentStatus.PAID },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { method: true },
          },
          items: {
            select: {
              id: true,
              quantity: true,
              unitPriceCents: true,
              taxCents: true,
              event: { select: { title: true } },
              ticketZone: { select: { name: true } },
            },
          },
        },
      });
      if (!order) throw new InvoiceAccessDeniedError();
      const hasValidAccessToken = Boolean(
        parsed.data.accessToken &&
          verifyOrderAccessToken(
            order.id,
            parsed.data.accessToken,
            getTicketSecret(),
          ),
      );
      const isAccountOwner = session?.user.id === order.userId;
      const isGuestEmailOwner =
        session?.user.email?.toLowerCase() === order.guestEmail.toLowerCase() ||
        parsed.data.email === order.guestEmail.toLowerCase();
      if (
        !hasValidAccessToken &&
        (order.userId ? !isAccountOwner : !isGuestEmailOwner)
      ) {
        throw new InvoiceAccessDeniedError();
      }
      if (
        order.status !== OrderStatus.CONFIRMED ||
        !order.payments[0]?.method ||
        !order.items.length
      ) {
        throw new InvoiceOrderUnavailableError();
      }
      const payload = buildFacturamaInvoicePayload(
        {
          orderNumber: order.orderNumber,
          subtotalCents: order.subtotalCents,
          taxCents: order.taxCents,
          serviceFeeCents: order.serviceFeeCents,
          totalCents: order.totalCents,
          paymentMethod: order.payments[0].method,
          items: order.items.map((item) => ({
            id: item.id,
            eventTitle: item.event.title,
            zoneName: item.ticketZone.name,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            taxCents: item.taxCents,
          })),
        },
        {
          Rfc: parsed.data.rfc,
          Name: parsed.data.legalName,
          FiscalRegime: parsed.data.taxRegime,
          TaxZipCode: parsed.data.postalCode,
          CfdiUse: parsed.data.cfdiUse,
        },
        config,
      );
      let invoiceId: string;
      let action: string;
      if (order.invoice) {
        const canRetry =
          order.invoice.status === InvoiceStatus.FAILED &&
          canRetryFacturamaFailure(order.invoice.failureCode);
        if (!canRetry) {
          throw new InvoiceAlreadyRequestedError(order.invoice.status);
        }
        const retry = await tx.invoice.updateMany({
          where: {
            id: order.invoice.id,
            status: InvoiceStatus.FAILED,
            failureCode: { in: retryableFacturamaFailureCodes },
          },
          data: {
            status: InvoiceStatus.PROCESSING,
            rfc: parsed.data.rfc,
            legalName: parsed.data.legalName,
            taxRegime: parsed.data.taxRegime,
            postalCode: parsed.data.postalCode,
            cfdiUse: parsed.data.cfdiUse,
            failureCode: null,
          },
        });
        if (retry.count !== 1) {
          throw new InvoiceAlreadyRequestedError(order.invoice.status);
        }
        invoiceId = order.invoice.id;
        action = "INVOICE_REQUEST_RETRIED";
      } else {
        const invoice = await tx.invoice.create({
          data: {
            orderId: order.id,
            status: InvoiceStatus.PROCESSING,
            rfc: parsed.data.rfc,
            legalName: parsed.data.legalName,
            taxRegime: parsed.data.taxRegime,
            postalCode: parsed.data.postalCode,
            cfdiUse: parsed.data.cfdiUse,
          },
          select: { id: true },
        });
        invoiceId = invoice.id;
        action = "INVOICE_REQUESTED";
      }
      await tx.auditLog.create({
        data: {
          ...(session ? { userId: session.user.id } : {}),
          orderId: order.id,
          action,
          entityType: "Invoice",
          entityId: invoiceId,
          details: { status: InvoiceStatus.PROCESSING },
        },
      });
      return {
        invoiceId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        payload,
      };
    });
    claim = claimed;

    providerInvoiceId = await createFacturamaInvoice(claim.payload, config);
    const invoice = await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: claimed.invoiceId },
        data: {
          status: InvoiceStatus.ISSUED,
          providerInvoiceId,
          pdfUrl: `/api/facturas/${encodeURIComponent(claimed.orderNumber)}/pdf`,
          xmlUrl: `/api/facturas/${encodeURIComponent(claimed.orderNumber)}/xml`,
        },
        select: { id: true, status: true, providerInvoiceId: true },
      });
      await tx.auditLog.create({
        data: {
          ...(session ? { userId: session.user.id } : {}),
          orderId: claimed.orderId,
          action: "INVOICE_ISSUED",
          entityType: "Invoice",
          entityId: updated.id,
          details: { status: updated.status },
        },
      });
      return updated;
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    if (error instanceof InvoiceAccessDeniedError) {
      return NextResponse.json({ error: "No encontramos una compra accesible con esos datos." }, { status: 404 });
    }
    if (error instanceof InvoiceOrderUnavailableError) {
      return NextResponse.json({ error: "La factura solo se puede solicitar para una compra pagada y confirmada." }, { status: 409 });
    }
    if (error instanceof InvoiceAlreadyRequestedError) {
      return NextResponse.json(
        {
          error:
            error.status === InvoiceStatus.FAILED || error.status === InvoiceStatus.PROCESSING
              ? "La solicitud ya existe y requiere revisión; no se volverá a emitir automáticamente para evitar duplicar el CFDI."
              : "Ya existe una factura para esta compra.",
        },
        { status: 409 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Ya existe una solicitud de factura para esta compra." }, { status: 409 });
    }
    if (error instanceof FacturamaConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isFacturamaRequestError(error) && claim && !providerInvoiceId) {
      const failureCode = facturamaFailureCode(error);
      await markInvoiceFailed(
        claim.invoiceId,
        claim.orderId,
        failureCode,
        session?.user.id,
      );
      console.error("Facturama no confirmó la emisión del CFDI.", {
        failureCode,
        invoiceId: claim.invoiceId,
      });
      return NextResponse.json(
        {
          error: canRetryFacturamaFailure(failureCode)
            ? "Facturama rechazó la solicitud. Revisa tus datos fiscales e inténtalo nuevamente."
            : "Facturama no confirmó la emisión. La solicitud quedó bloqueada para evitar duplicados; contacta soporte antes de volver a solicitarla.",
        },
        { status: 502 },
      );
    }
    if (claim && providerInvoiceId) {
      console.error("Facturama emitió el CFDI, pero no se pudo confirmar en la base local.", {
        invoiceId: claim.invoiceId,
        providerInvoiceId,
        message: error instanceof Error ? error.message : "Error desconocido.",
      });
      return NextResponse.json(
        { error: "Facturama pudo emitir el CFDI, pero su estado local requiere conciliación manual. No vuelvas a solicitarlo." },
        { status: 502 },
      );
    }
    console.error("No se pudo emitir el CFDI en Facturama.", {
      message: error instanceof Error ? error.message : "Error desconocido del proveedor.",
    });
    throw error;
  }
}
