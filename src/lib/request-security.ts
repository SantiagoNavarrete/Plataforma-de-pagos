export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const appUrl = process.env.APP_URL;
  if (!origin || !appUrl) return false;

  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}
