import type { Metadata } from "next";
import AccountPanel from "@/components/account-panel";

export const metadata: Metadata = {
  title: "Mi cuenta",
  robots: { index: false, follow: false },
};

type AccountPageProps = {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
};

function safeCallbackUrl(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/cuenta";
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const { callbackUrl } = await searchParams;

  return <AccountPanel callbackUrl={safeCallbackUrl(callbackUrl)} googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)} />;
}
