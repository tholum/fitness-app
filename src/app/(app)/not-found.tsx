import Link from "next/link";

/* Branded 404 for authed routes (e.g. a stale /programs/[id] link). Renders
   inside the app shell, so the bottom nav stays usable; without this file
   notFound() falls through to the stock Next.js page, whose near-black text
   is illegible on the dark background. */
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 py-16 text-center">
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
        href="/today"
        className="rounded-[18px] bg-grad px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-on-grad shadow-[0_6px_18px_rgba(200,98,45,.28)]"
      >
        Back to Today
      </Link>
    </div>
  );
}
