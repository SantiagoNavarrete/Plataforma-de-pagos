"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type AccountPanelProps = {
  callbackUrl: string;
  googleEnabled: boolean;
};

export default function AccountPanel({
  callbackUrl,
  googleEnabled,
}: AccountPanelProps) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              name: name.trim(),
              email: email.trim().toLowerCase(),
              password,
            })
          : await authClient.signIn.email({
              email: email.trim().toLowerCase(),
              password,
            });

      if (result.error) {
        throw new Error(result.error.message || "No se pudo completar el acceso.");
      }
      if (mode === "signup") {
        setNotice("Te enviamos un correo para confirmar tu cuenta antes de iniciar sesión.");
        setMode("signin");
        setPassword("");
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No se pudo completar el acceso. Intenta de nuevo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signInWithGoogle() {
    setError("");
    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: callbackUrl,
      });
      if (result.error) {
        throw new Error(result.error.message || "No se pudo iniciar sesión con Google.");
      }
    } catch (googleError) {
      setError(
        googleError instanceof Error
          ? googleError.message
          : "No se pudo iniciar sesión con Google.",
      );
      setIsSubmitting(false);
    }
  }

  async function signOut() {
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(result.error.message || "No se pudo cerrar la sesión.");
        return;
      }
      router.refresh();
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "No se pudo cerrar la sesión.",
      );
    }
  }

  return (
    <main className="auth-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Boleta — inicio">
          <span className="brand-mark" aria-hidden="true">b.</span>
          <span>boleta<span className="brand-period">.</span></span>
        </Link>
        <Link className="back-link" href="/">Volver a eventos</Link>
        <span className="checkout-secure-label">MI CUENTA</span>
      </header>

      <section className="auth-card" aria-live="polite">
        {isPending ? (
          <p>Comprobando tu sesión…</p>
        ) : session ? (
          <>
            <span className="section-kicker">TU CUENTA</span>
            <h1>Qué gusto verte, <span>{session.user.name || "bienvenido"}.</span></h1>
            <p>{session.user.email}</p>
            <div className="auth-actions">
              <Link className="button-primary" href="/cuenta/compras">Ver mis compras <span aria-hidden="true">→</span></Link>
              {session.user.role === "admin" && (
                <Link className="button-secondary" href="/admin">Abrir administración</Link>
              )}
              <button className="button-secondary" type="button" onClick={() => void signOut()}>Cerrar sesión</button>
            </div>
          </>
        ) : (
          <>
            <span className="section-kicker">{mode === "signup" ? "CREA TU CUENTA" : "BIENVENIDO DE VUELTA"}</span>
            <h1>{mode === "signup" ? <>Todo listo para <span>salir.</span></> : <>Tus planes, <span>aquí.</span></>}</h1>
            <p className="auth-description">
              {mode === "signup"
                ? "Confirma tu correo para mantener tus compras y boletos vinculados a tu cuenta."
                : "Inicia sesión para consultar tus compras. También puedes comprar como invitado."}
            </p>
            {googleEnabled && (
              <button className="button-secondary auth-google-button" type="button" disabled={isSubmitting} onClick={() => void signInWithGoogle()}>
                Continuar con Google
              </button>
            )}
            <div className="auth-divider"><span>o con tu correo</span></div>
            <form className="auth-form" onSubmit={submit}>
              {mode === "signup" && (
                <label>
                  Nombre
                  <input autoComplete="name" maxLength={160} value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
              )}
              <label>
                Correo electrónico
                <input type="email" autoComplete="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label>
                Contraseña
                <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
              </label>
              {error && <p className="admin-error" role="alert">{error}</p>}
              {notice && <p className="admin-inline-note" role="status">{notice}</p>}
              <button className="button-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Procesando…" : mode === "signup" ? "Crear cuenta" : "Iniciar sesión"} <span aria-hidden="true">→</span>
              </button>
            </form>
            <p className="auth-mode-switch">
              {mode === "signup" ? "¿Ya tienes cuenta?" : "¿Aún no tienes cuenta?"}{" "}
              <button type="button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setNotice(""); }}>
                {mode === "signup" ? "Inicia sesión" : "Regístrate"}
              </button>
            </p>
            <p className="auth-guest-note">La cuenta es opcional. <Link href="/">Puedes continuar como invitado</Link> al comprar boletos.</p>
          </>
        )}
      </section>
    </main>
  );
}
