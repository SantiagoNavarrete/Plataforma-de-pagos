import nodemailer from "nodemailer";

type AuthEmail = {
  to: string;
  subject: string;
  actionUrl: string;
  actionLabel: string;
};

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

export async function sendAuthEmail({
  to,
  subject,
  actionUrl,
  actionLabel,
}: AuthEmail) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !user ||
    !password ||
    !from
  ) {
    throw new Error(
      "Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD y SMTP_FROM para el correo de acceso.",
    );
  }

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
      to,
      subject,
      text: `${actionLabel}: ${actionUrl}\n\nSi no solicitaste esta acción, puedes ignorar este correo.`,
      html: `<p>${escapeHtml(actionLabel)}.</p><p><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionLabel)}</a></p><p>Si no solicitaste esta acción, puedes ignorar este correo.</p>`,
    });
  } finally {
    transporter.close();
  }
}
