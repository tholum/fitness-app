import Link from "next/link";

/* Root catch-all 404 (logged-out / non-app paths) — branded to match the
   login screen instead of the stock unstyled Next.js page. */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <p className="font-display text-[64px] font-bold leading-none text-faint">
        404
      </p>
      <div>
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-text">
          Off the trail
        </h1>
        <p className="mt-1 font-cond text-sm text-muted">
          That page doesn&apos;t exist — it may have been moved or deleted.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-[18px] bg-grad px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-on-grad shadow-[0_6px_18px_rgba(200,98,45,.28)]"
      >
        Back to base camp
      </Link>
    </div>
  );
}
