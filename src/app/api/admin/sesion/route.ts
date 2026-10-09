import { NextResponse } from "next/server";
import { isAuthenticationConfigured } from "@/lib/auth-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthenticationConfigured()) {
    console.error("Falta configurar APP_URL y AUTH_SECRET.");
    return NextResponse.json(
      { error: "La autenticación no está configurada." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { auth } = await import("@/lib/auth");
  const session = await auth.api.getSession({ headers: request.headers });
  const authenticated = session?.user.role === "admin";
  return NextResponse.json(
    {
      authenticated,
      signedIn: Boolean(session),
      ...(session && !authenticated
        ? { message: "Esta cuenta no tiene permisos de administración." }
        : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
