import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const preferenceResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  init_point: z.string().url(),
  sandbox_init_point: z.string().url().optional(),
});

export const paymentResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  status_detail: z.string().optional(),
  external_reference: z.string().nullable(),
  transaction_amount: z.number(),
  transaction_amount_refunded: z.number().optional(),
  currency_id: z.string(),
  payment_type_id: z.string().nullable().optional(),
  payment_method_id: z.string().nullable().optional(),
  preference_id: z.string().nullable().optional(),
}).passthrough();

export type MercadoPagoPayment = z.infer<typeof paymentResponseSchema>;

export class MercadoPagoHttpError extends Error {
  constructor(
    readonly status: number,
    message = "Mercado Pago no pudo completar la solicitud.",
  ) {
    super(message);
    this.name = "MercadoPagoHttpError";
  }
}

export class MercadoPagoResponseError extends Error {
  constructor() {
    super("Mercado Pago devolvió una respuesta que no pudimos verificar.");
    this.name = "MercadoPagoResponseError";
  }
}

export class MercadoPagoRefundError extends Error {
  constructor() {
    super("No se pudo completar el reembolso automático.");
    this.name = "MercadoPagoRefundError";
  }
}

async function readResponse(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error("Mercado Pago devolvió JSON inválido.", { status: response.status });
      throw new MercadoPagoResponseError();
    }
    throw error;
  }
}

export function isMercadoPagoCheckoutUrl(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    /(^|\.)mercadopago\.com(\.mx)?$/i.test(url.hostname)
  );
}

export function verifyMercadoPagoSignature({
  dataId,
  requestId,
  signature,
  secret,
}: {
  dataId: string;
  requestId: string;
  signature: string;
  secret: string;
}) {
  const parts = Object.fromEntries(
    signature.split(",").map((part) => {
      const [key, value] = part.trim().split("=", 2);
      return [key, value];
    }),
  );
  const timestamp = parts.ts;
  const suppliedHash = parts.v1;

  if (
    !timestamp ||
    !suppliedHash ||
    !/^[a-f0-9]{64}$/i.test(suppliedHash)
  ) {
    return false;
  }

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const expectedHash = createHmac("sha256", secret).update(manifest).digest();
  const receivedHash = Buffer.from(suppliedHash, "hex");

  return (
    expectedHash.length === receivedHash.length &&
    timingSafeEqual(expectedHash, receivedHash)
  );
}

export async function createMercadoPagoPreference(
  accessToken: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
) {
  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const responseBody = await readResponse(response);

  if (!response.ok) {
    console.error("Mercado Pago rechazó la preferencia de pago.", {
      status: response.status,
    });
    throw new MercadoPagoHttpError(response.status);
  }

  const parsed = preferenceResponseSchema.safeParse(responseBody);
  if (!parsed.success || !isMercadoPagoCheckoutUrl(parsed.data.init_point)) {
    console.error("Mercado Pago devolvió una preferencia incompleta o una URL no permitida.");
    throw new MercadoPagoResponseError();
  }

  if (
    parsed.data.sandbox_init_point &&
    !isMercadoPagoCheckoutUrl(parsed.data.sandbox_init_point)
  ) {
    console.error("Mercado Pago devolvió una URL de pruebas no permitida.");
    throw new MercadoPagoResponseError();
  }

  return parsed.data;
}

export async function getMercadoPagoPayment(
  accessToken: string,
  paymentId: string,
) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const responseBody = await readResponse(response);

  if (!response.ok) {
    console.error("Mercado Pago rechazó la consulta de pago.", {
      status: response.status,
    });
    throw new MercadoPagoHttpError(response.status);
  }

  const parsed = paymentResponseSchema.safeParse(responseBody);
  if (!parsed.success) {
    console.error("Mercado Pago devolvió un pago con datos incompletos.");
    throw new MercadoPagoResponseError();
  }

  return parsed.data;
}

export async function refundMercadoPagoPayment(
  accessToken: string,
  paymentId: string,
) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `boleta-refund-${paymentId}`,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    console.error("Mercado Pago no pudo reembolsar un pago tardío.", {
      status: response.status,
    });
    throw new MercadoPagoRefundError();
  }

  await readResponse(response);
}
