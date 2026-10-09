import { InvoiceStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { isAuthenticationConfigured } from "@/lib/auth-config";
import {
  downloadFacturamaDocument,
  FacturamaConfigurationError,
  FacturamaHttpError,
  FacturamaNetworkError,
  FacturamaResponseError,
  getFacturamaApiConfig,
} from "@/lib/facturama";
import { getTicketSecret, verifyOrderAccessToken } from "@/lib/tickets";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type InvoiceDocumentRouteProps = {
  params: Promise<{ orderNumber: string; format: string }>;
};

function providerFailureCode(error: unknown) {
  if (error instanceof FacturamaHttpError) return `FACTURAMA_HTTP_${error.status}`;
  if (error instanceof FacturamaResponseError) return "FACTURAMA_INVALID_RESPONSE";
  if (error instanceof FacturamaNetworkError) return "FACTURAMA_NETWORK_ERROR";
  return "FACTURAMA_UNKNOWN_ERROR";
}

export async function GET(request: Request, { params }: InvoiceDocumentRouteProps) {
  const { orderNumber, format } = await params;
  if (!/^BO-[0-9A-F]{28}$/i.test(orderNumber) || (format !== "pdf" && format !== "xml")) {
    return NextResponse.json({ error: "El documento solicitado no es válido." }, { status: 400 });
  }

  const session = isAuthenticationConfigured()
    ? await (await import("@/lib/auth")).auth.api.getSession({
        headers: request.headers,
      })
    : null;
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      userId: true,
      invoice: {
        select: {
          id: true,
          status: true,
          providerInvoiceId: true,
        },
      },
    },
  });
  if (
    !order ||
    !order.invoice ||
    order.invoice.status !== InvoiceStatus.ISSUED ||
    !order.invoice.providerInvoiceId
  ) {
    return NextResponse.json({ error: "No encontramos el CFDI solicitado." }, { status: 404 });
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const canAccess =
    session?.user.id === order.userId ||
    Boolean(
      token &&
        verifyOrderAccessToken(order.id, token, getTicketSecret()),
    );
  if (!canAccess) {
    return NextResponse.json({ error: "No encontramos el CFDI solicitado." }, { status: 404 });
  }

  let content: Buffer;
  try {
    content = await downloadFacturamaDocument(
      format,
      order.invoice.providerInvoiceId,
      getFacturamaApiConfig(),
    );
  } catch (error) {
    if (error instanceof FacturamaConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const failureCode = providerFailureCode(error);
    console.error("No se pudo descargar el CFDI desde Facturama.", {
      invoiceId: order.invoice.id,
      format,
      failureCode,
    });
    return NextResponse.json(
      { error: "Facturama no pudo entregar el documento. Intenta más tarde o contacta soporte." },
      { status: 502 },
    );
  }

  const extension = format === "pdf" ? "pdf" : "xml";
  const contentType = format === "pdf" ? "application/pdf" : "application/xml; charset=utf-8";
  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="Factura-${orderNumber}.${extension}"`,
      "Content-Length": String(content.length),
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
