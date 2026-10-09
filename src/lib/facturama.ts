import { PaymentMethod } from "@prisma/client";
import { z } from "zod";

const createResponseSchema = z.object({ Id: z.string().min(1) }).passthrough();
const documentResponseSchema = z.object({ Content: z.string().min(1) }).passthrough();

export class FacturamaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacturamaConfigurationError";
  }
}

export class FacturamaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Facturama respondió con HTTP ${status}.`);
    this.name = "FacturamaHttpError";
  }
}

export class FacturamaResponseError extends Error {
  constructor() {
    super("Facturama devolvió una respuesta que no se pudo interpretar.");
    this.name = "FacturamaResponseError";
  }
}

export class FacturamaNetworkError extends Error {
  constructor() {
    super("No se pudo confirmar la respuesta de Facturama.");
    this.name = "FacturamaNetworkError";
  }
}

const retryableProviderFailureCodes = new Set([
  "FACTURAMA_HTTP_400",
  "FACTURAMA_HTTP_401",
  "FACTURAMA_HTTP_403",
  "FACTURAMA_HTTP_422",
  "FACTURAMA_HTTP_429",
]);

export function canRetryFacturamaFailure(failureCode: string | null) {
  return failureCode !== null && retryableProviderFailureCodes.has(failureCode);
}

export const retryableFacturamaFailureCodes = [...retryableProviderFailureCodes];

type FacturamaConfig = {
  baseUrl: string;
  username: string;
  password: string;
  nameId: string;
  expeditionPlace: string;
  productCode: string;
  unitCode: string;
  unit: string;
  serie?: string;
  paymentForms: Partial<Record<PaymentMethod, string>>;
};

type FacturamaApiConfig = Pick<
  FacturamaConfig,
  "baseUrl" | "username" | "password"
>;

type InvoiceLine = {
  id: string;
  eventTitle: string;
  zoneName: string;
  quantity: number;
  unitPriceCents: number;
  taxCents: number;
};

type InvoiceOrder = {
  orderNumber: string;
  subtotalCents: number;
  taxCents: number;
  serviceFeeCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  items: InvoiceLine[];
};

type FacturamaInvoicePayload = {
  NameId: string;
  Currency: "MXN";
  CfdiType: "I";
  PaymentForm: string;
  PaymentMethod: "PUE";
  OrderNumber: string;
  ExpeditionPlace: string;
  Exportation: "01";
  Serie?: string;
  Receiver: {
    Rfc: string;
    CfdiUse: string;
    Name: string;
    FiscalRegime: string;
    TaxZipCode: string;
  };
  Items: Array<{
    ProductCode: string;
    IdentificationNumber: string;
    Description: string;
    Unit: string;
    UnitCode: string;
    UnitPrice: number;
    Quantity: number;
    Subtotal: number;
    TaxObject: "02";
    Taxes: Array<{
      Total: number;
      Name: "IVA";
      Base: number;
      Rate: 0.16;
      IsRetention: false;
    }>;
    Total: number;
  }>;
};

function requiredValue(
  name: string,
  value: string | undefined,
  pattern?: RegExp,
) {
  if (!value || (pattern && !pattern.test(value))) {
    throw new FacturamaConfigurationError(
      `Configura ${name} con un valor válido antes de emitir CFDI.`,
    );
  }
  return value;
}

export function getFacturamaApiConfig(): FacturamaApiConfig {
  const environment = process.env.FACTURAMA_ENVIRONMENT ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new FacturamaConfigurationError(
      "FACTURAMA_ENVIRONMENT debe ser sandbox o production.",
    );
  }

  return {
    baseUrl:
      environment === "production"
        ? "https://api.facturama.mx"
        : "https://apisandbox.facturama.mx",
    username: requiredValue("FACTURAMA_USER", process.env.FACTURAMA_USER),
    password: requiredValue("FACTURAMA_PASSWORD", process.env.FACTURAMA_PASSWORD),
  };
}

export function getFacturamaConfig(): FacturamaConfig {
  return {
    ...getFacturamaApiConfig(),
    nameId: requiredValue(
      "FACTURAMA_NAME_ID",
      process.env.FACTURAMA_NAME_ID,
      /^\d+$/,
    ),
    expeditionPlace: requiredValue(
      "FACTURAMA_EXPEDITION_PLACE",
      process.env.FACTURAMA_EXPEDITION_PLACE,
      /^\d{5}$/,
    ),
    productCode: requiredValue(
      "FACTURAMA_PRODUCT_CODE",
      process.env.FACTURAMA_PRODUCT_CODE,
      /^\d{8}$/,
    ),
    unitCode: requiredValue(
      "FACTURAMA_UNIT_CODE",
      process.env.FACTURAMA_UNIT_CODE,
      /^[A-Z0-9]{2,3}$/,
    ),
    unit: requiredValue("FACTURAMA_UNIT", process.env.FACTURAMA_UNIT),
    serie: process.env.FACTURAMA_SERIE || undefined,
    paymentForms: {
      [PaymentMethod.CREDIT_CARD]: process.env.FACTURAMA_PAYMENT_FORM_CREDIT_CARD,
      [PaymentMethod.DEBIT_CARD]: process.env.FACTURAMA_PAYMENT_FORM_DEBIT_CARD,
      [PaymentMethod.WALLET]: process.env.FACTURAMA_PAYMENT_FORM_WALLET,
    },
  };
}

export function buildFacturamaInvoicePayload(
  order: InvoiceOrder,
  receiver: FacturamaInvoicePayload["Receiver"],
  config = getFacturamaConfig(),
): FacturamaInvoicePayload {
  if (order.serviceFeeCents !== 0) {
    throw new FacturamaConfigurationError(
      "El esquema fiscal actual solo contempla cargo de servicio de $0 MXN.",
    );
  }

  const paymentForm = config.paymentForms[order.paymentMethod];
  if (!paymentForm || !/^\d{2}$/.test(paymentForm)) {
    throw new FacturamaConfigurationError(
      `Configura FACTURAMA_PAYMENT_FORM_${order.paymentMethod} con la clave SAT acordada para este medio de pago.`,
    );
  }

  const subtotalCents = order.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  const taxCents = order.items.reduce((sum, item) => sum + item.taxCents, 0);
  if (
    !order.items.length ||
    subtotalCents !== order.subtotalCents ||
    taxCents !== order.taxCents ||
    subtotalCents + taxCents !== order.totalCents
  ) {
    throw new FacturamaConfigurationError(
      "Los importes de la orden no coinciden con los conceptos fiscales.",
    );
  }

  return {
    NameId: config.nameId,
    Currency: "MXN",
    CfdiType: "I",
    PaymentForm: paymentForm,
    PaymentMethod: "PUE",
    OrderNumber: order.orderNumber,
    ExpeditionPlace: config.expeditionPlace,
    Exportation: "01",
    ...(config.serie ? { Serie: config.serie } : {}),
    Receiver: receiver,
    Items: order.items.map((item) => {
      const baseCents = item.unitPriceCents * item.quantity;
      if (item.taxCents !== Math.round(baseCents * 0.16)) {
        throw new FacturamaConfigurationError(
          "El IVA del concepto no coincide con el 16% aplicado en el checkout.",
        );
      }
      return {
        ProductCode: config.productCode,
        IdentificationNumber: item.id,
        Description: `Boleto para ${item.eventTitle} — ${item.zoneName}`,
        Unit: config.unit,
        UnitCode: config.unitCode,
        UnitPrice: item.unitPriceCents / 100,
        Quantity: item.quantity,
        Subtotal: baseCents / 100,
        TaxObject: "02",
        Taxes: [
          {
            Total: item.taxCents / 100,
            Name: "IVA",
            Base: baseCents / 100,
            Rate: 0.16,
            IsRetention: false,
          },
        ],
        Total: (baseCents + item.taxCents) / 100,
      };
    }),
  };
}

async function parseJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new FacturamaResponseError();
    throw error;
  }
}

function authorizationHeader(config: FacturamaApiConfig) {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
}

export async function createFacturamaInvoice(
  payload: FacturamaInvoicePayload,
  config = getFacturamaConfig(),
) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/3/cfdis`, {
      method: "POST",
      headers: {
        Authorization: authorizationHeader(config),
        "Content-Type": "application/json",
        "User-Agent": config.username,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new FacturamaNetworkError();
  }

  if (!response.ok) throw new FacturamaHttpError(response.status);
  const result = createResponseSchema.safeParse(await parseJson(response));
  if (!result.success) throw new FacturamaResponseError();
  return result.data.Id;
}

export async function downloadFacturamaDocument(
  format: "pdf" | "xml",
  invoiceId: string,
  config = getFacturamaApiConfig(),
) {
  let response: Response;
  try {
    response = await fetch(
      `${config.baseUrl}/Cfdi/${format}/issued/${encodeURIComponent(invoiceId)}`,
      {
        headers: {
          Authorization: authorizationHeader(config),
          "User-Agent": config.username,
        },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      },
    );
  } catch {
    throw new FacturamaNetworkError();
  }

  if (!response.ok) throw new FacturamaHttpError(response.status);
  const result = documentResponseSchema.safeParse(await parseJson(response));
  if (
    !result.success ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data.Content) ||
    result.data.Content.length % 4 === 1
  ) {
    throw new FacturamaResponseError();
  }
  const content = Buffer.from(result.data.Content, "base64");
  if (
    !content.length ||
    content.toString("base64").replace(/=+$/, "") !==
      result.data.Content.replace(/=+$/, "") ||
    (format === "pdf" && !content.subarray(0, 5).equals(Buffer.from("%PDF-"))) ||
    (format === "xml" &&
      !/^\s*(?:<\?xml[\s\S]*?\?>\s*)?</.test(content.toString("utf8").replace(/^\uFEFF/, "")))
  ) {
    throw new FacturamaResponseError();
  }
  return content;
}
