"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

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

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setMagicSent(false);
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) throw error;
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
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
            Train the program
          </div>
          <h1 className="mt-1 font-display text-5xl font-bold uppercase leading-none tracking-wide text-text">
            Basecamp
          </h1>
          <p className="mt-3 text-sm text-muted">
            Keep the crew honest.
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
                disabled={loading}
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
                <div className="rounded-[14px] border border-line bg-surface2 p-5 text-center">
                  <div className="font-display text-base font-semibold uppercase tracking-wide text-text">
                    Check your email
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    We sent a sign-in link to{" "}
                    <span className="text-text">{email}</span>. Open it on this
                    device to continue.
                  </p>
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
                    disabled={loading}
                    className="mt-1 w-full rounded-[18px] bg-grad px-4 py-4 font-display text-[15px] font-semibold uppercase tracking-wider text-bg shadow-[0_8px_24px_rgba(200,98,45,0.3)] disabled:opacity-60"
                  >
                    {loading ? "..." : "Send magic link"}
                  </button>
                </>
              )}
            </form>
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
            Basecamp
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
