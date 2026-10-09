export function isAuthenticationConfigured() {
  return Boolean(
    process.env.APP_URL &&
      (process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET),
  );
}

export function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
