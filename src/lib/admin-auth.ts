import { NextResponse } from "next/server";
import { isAuthenticationConfigured } from "@/lib/auth-config";
import { isSameOriginRequest } from "@/lib/request-security";

export type AdminAuthorizationResult =
  | { userId: string; response?: never }
  | { response: NextResponse; userId?: never };

export async function requireAdminSession(request: Request) {
  if (!isAuthenticationConfigured()) {
    console.error("Falta configurar APP_URL y AUTH_SECRET para autenticación.");
    return {
      response: NextResponse.json(
        { error: "La autenticación no está configurada." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  const { auth } = await import("@/lib/auth");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      response: NextResponse.json(
        { error: "Inicia sesión para continuar." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  if (session.user.role !== "admin") {
    return {
      response: NextResponse.json(
        { error: "Tu cuenta no tiene permisos de administración." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    !isSameOriginRequest(request)
  ) {
    return {
      response: NextResponse.json(
        { error: "La solicitud no proviene de este sitio." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }

  return { userId: session.user.id };
}
