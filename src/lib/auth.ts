import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { sendAuthEmail } from "@/lib/auth-mailer";
import { prisma } from "@/lib/prisma";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const baseURL = process.env.APP_URL;

if (!baseURL) {
  throw new Error("APP_URL debe configurarse para autenticación.");
}

export const auth = betterAuth({
  appName: "Boleta",
  baseURL,
  secret: process.env.AUTH_SECRET,
  trustedOrigins: [baseURL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Recupera el acceso a tu cuenta de Boleta",
        actionUrl: url,
        actionLabel: "Restablecer contraseña",
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Confirma tu correo en Boleta",
        actionUrl: url,
        actionLabel: "Confirmar correo electrónico",
      });
    },
  },
  socialProviders: googleClientId && googleClientSecret
    ? {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        },
      }
    : {},
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 10,
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
  ],
});
