import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { isAuthenticationConfigured } from "@/lib/auth-config";

async function dispatch(
  method: "GET" | "POST",
  request: Request,
) {
  if (!isAuthenticationConfigured()) {
    return NextResponse.json(
      { error: "La autenticación no está configurada." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { auth } = await import("@/lib/auth");
  const handler = toNextJsHandler(auth)[method];
  return handler(request);
}

export function GET(request: Request) {
  return dispatch("GET", request);
}

export function POST(request: Request) {
  return dispatch("POST", request);
}
