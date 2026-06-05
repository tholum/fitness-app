"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

/**
 * Cloudflare Turnstile site key. When unset the captcha is disabled and the
 * forms behave exactly as before — keeping local/dev and unconfigured
 * deployments working with no extra setup. When set, every auth call below
 * (sign-in, sign-up, magic link) requires a fresh `captchaToken`, which is the
 * app-side half of the rate-limiting fix: Supabase Auth → Rate Limits caps
 * attempts per IP/email server-side, and this widget forces a proof-of-work /
 * interaction before a request is ever made, blunting scripted credential
 * stuffing and magic-link mail-bombing (threat model A). Must also be enabled
 * in the Supabase dashboard (Auth → Settings → Enable Captcha protection,
 * provider = Turnstile) for the token to be verified.
 */
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Load the Turnstile script once (idempotent across mounts). */
let turnstileScriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      // Allow a later mount to retry rather than wedging on a failed load.
      turnstileScriptPromise = null;
      reject(new Error("Failed to load captcha"));
    };
    // Injected from this already-trusted (nonce'd) bundle, so under the app's
    // `strict-dynamic` CSP the loader and the resources it pulls are trusted
    // transitively — no per-tag nonce or script-src host change required.
    document.head.appendChild(s);
  });
  return turnstileScriptPromise;
}

/**
 * Renders a Turnstile widget when a site key is configured and surfaces the
 * latest token. Returns `enabled=false` (and an always-ready token) when no
 * key is set so callers can stay agnostic. `reset()` clears the consumed
 * single-use token after each auth attempt.
 */
function useTurnstile() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const enabled = Boolean(TURNSTILE_SITE_KEY);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        // Avoid double-render under React 18/19 strict-mode double effects.
        if (widgetIdRef.current) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY!,
          theme: "dark",
          callback: (t) => setToken(t),
          "error-callback": () => setToken(null),
          "expired-callback": () => setToken(null),
        });
      })
      .catch(() => {
        /* surfaced to the user as a missing token on submit */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  return { enabled, token, reset, containerRef };
}

/**
 * `useSearchParams()` forces this subtree to render on the client, so it must
 * sit inside a <Suspense> boundary (see the default export below) for Next 15
 * to prerender the route shell.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/today";

  const [mode, setMode] = useState<Mode>("password");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [code, setCode] = useState("");

  const { enabled: captchaEnabled, token: captchaToken, reset: resetCaptcha, containerRef: captchaRef } =
    useTurnstile();
  // When captcha is on, block submission until a token exists. The widget's
  // single-use token is also reset after every attempt below so a retry forces
  // a fresh challenge.
  const captchaMissing = captchaEnabled && !captchaToken;

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setMagicSent(false);
    setCode("");
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (captchaMissing) {
      setError("Please complete the verification first.");
      return;
    }
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const captcha = captchaToken ?? undefined;
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            captchaToken: captcha,
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: captcha },
        });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      // Turnstile tokens are single-use; clear it so the next submit re-challenges.
      resetCaptcha();
      setLoading(false);
    }
  }

  // Sends the email OTP. The email template is configured to deliver a 6-digit
  // *code* (no clickable link) — see supabase/templates/magic_link.html. A
  // code-only email is immune to the single-use-token consumption that breaks
  // magic links: corporate mail scanners / link-preview bots fetch (and thereby
  // burn) any URL in the message before the user clicks, producing the classic
  // "otp_expired even though I clicked immediately" failure. There is no URL to
  // fetch here, so the user types the code into the next step instead.
  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    if (captchaMissing) {
      setError("Please complete the verification first.");
      return;
    }
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const captcha = captchaToken ?? undefined;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { captchaToken: captcha },
      });
      if (error) throw error;
      setCode("");
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      resetCaptcha();
      setLoading(false);
    }
  }

  // Exchanges the emailed 6-digit code for a session directly (no PKCE / no
  // /auth/callback round-trip), which also sidesteps the cross-device breakage
  // magic links suffer when opened in a different browser than they were
  // requested from.
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      router.push(next);
      router.refresh();
    } catch {
      setError("That code is invalid or expired. Request a new one.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center overflow-hidden px-6 pb-12 pt-16">
      {/* topo texture */}
      <svg
        className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-[0.06]"
        viewBox="0 0 390 844"
        preserveAspectRatio="none"
        aria-hidden
      >
        <g fill="none" stroke="#c8622d" strokeWidth="1">
          <path d="M-20 140 Q120 60 260 140 T560 140" />
          <path d="M-20 180 Q120 110 260 180 T560 180" />
          <path d="M-20 460 Q140 400 280 470 T580 460" />
          <path d="M-20 500 Q140 450 280 510 T580 500" />
          <path d="M-20 720 Q120 660 260 730 T560 720" />
        </g>
      </svg>
      {/* glow */}
      <div className="pointer-events-none absolute -left-16 -top-24 z-0 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -right-20 z-0 h-72 w-72 rounded-full bg-accent2/20 blur-3xl" />

      <div className="relative z-10">
        {/* Brand / hero */}
        <div className="mb-8 text-center">
          <div className="font-cond text-[11px] uppercase tracking-[2px] text-muted">
            The path is narrow
          </div>
          <h1 className="mt-1 font-display text-5xl font-bold uppercase leading-none tracking-wide text-text">
            Path Warden
          </h1>
          <p className="mt-3 text-sm text-muted">
            Walk it with intent.
          </p>
        </div>

        {/* Mode segmented control */}
        <div className="mb-5 flex rounded-card border border-line bg-surface p-1">
          <button
            type="button"
            onClick={() => switchMode("password")}
            className={`flex-1 rounded-[14px] px-3 py-2.5 font-display text-xs font-semibold uppercase tracking-wider transition ${
              mode === "password" ? "bg-grad text-bg" : "text-muted"
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => switchMode("magic")}
            className={`flex-1 rounded-[14px] px-3 py-2.5 font-display text-xs font-semibold uppercase tracking-wider transition ${
              mode === "magic" ? "bg-grad text-bg" : "text-muted"
            }`}
          >
            Magic link
          </button>
        </div>

        <div className="rounded-card border border-line bg-surface p-6 backdrop-blur">
          {mode === "password" ? (
            <form onSubmit={handlePassword} className="flex flex-col gap-4">
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-text">
                {isSignUp ? "Create account" : "Sign in"}
              </h2>

              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@trail.com"
                autoComplete="email"
              />
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />

              {error && <ErrorNote message={error} />}

              <button
                type="submit"
                disabled={loading || captchaMissing}
                className="mt-1 w-full rounded-[18px] bg-grad px-4 py-4 font-display text-[15px] font-semibold uppercase tracking-wider text-bg shadow-[0_8px_24px_rgba(200,98,45,0.3)] disabled:opacity-60"
              >
                {loading ? "..." : isSignUp ? "Create account" : "Sign in"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSignUp((v) => !v);
                  setError(null);
                }}
                className="text-center font-cond text-[11px] uppercase tracking-wider text-gold"
              >
                {isSignUp
                  ? "Have an account? Sign in"
                  : "New here? Create an account"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMagic} className="flex flex-col gap-4">
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-text">
                Magic link
              </h2>

              {magicSent ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-[14px] border border-line bg-surface2 p-5 text-center">
                    <div className="font-display text-base font-semibold uppercase tracking-wide text-text">
                      Check your email
                    </div>
                    <p className="mt-2 text-sm text-muted">
                      We sent a 6-digit code to{" "}
                      <span className="text-text">{email}</span>. Enter it below
                      to sign in.
                    </p>
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="font-cond text-[11px] uppercase tracking-wider text-muted">
                      Sign-in code
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && code.length === 6) {
                          handleVerifyCode(e);
                        }
                      }}
                      placeholder="123456"
                      autoFocus
                      className="w-full rounded-[14px] border border-line-solid bg-bg2 px-4 py-3 text-center font-display text-2xl tracking-[8px] text-text placeholder:text-faint placeholder:tracking-[8px] outline-none focus:border-accent"
                    />
                  </label>

                  {error && <ErrorNote message={error} />}

                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={loading || code.length < 6}
                    className="mt-1 w-full rounded-[18px] bg-grad px-4 py-4 font-display text-[15px] font-semibold uppercase tracking-wider text-bg shadow-[0_8px_24px_rgba(200,98,45,0.3)] disabled:opacity-60"
                  >
                    {loading ? "..." : "Verify & sign in"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMagicSent(false);
                      setCode("");
                      setError(null);
                    }}
                    className="text-center font-cond text-[11px] uppercase tracking-wider text-gold"
                  >
                    Use a different email / resend code
                  </button>
                </div>
              ) : (
                <>
                  <Field
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@trail.com"
                    autoComplete="email"
                  />

                  {error && <ErrorNote message={error} />}

                  <button
                    type="submit"
                    disabled={loading || captchaMissing}
                    className="mt-1 w-full rounded-[18px] bg-grad px-4 py-4 font-display text-[15px] font-semibold uppercase tracking-wider text-bg shadow-[0_8px_24px_rgba(200,98,45,0.3)] disabled:opacity-60"
                  >
                    {loading ? "..." : "Send magic link"}
                  </button>
                </>
              )}
            </form>
          )}

          {/* Captcha lives at the card level (outside the two <form>s) so the
              single Turnstile widget instance survives password⇄magic toggles
              and isn't torn down/re-created. Only present when a site key is
              configured; otherwise this renders nothing and the forms are
              unchanged. */}
          {captchaEnabled && (
            <div className="mt-4 flex justify-center">
              <div ref={captchaRef} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-[440px] items-center justify-center px-6">
          <div className="font-display text-5xl font-bold uppercase tracking-wide text-text">
            Path Warden
          </div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-cond text-[11px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full rounded-[14px] border border-line-solid bg-bg2 px-4 py-3 text-text placeholder:text-faint outline-none focus:border-accent"
      />
    </label>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
