/* ════════════════════════════════════════════════════════════════════
   cx — tiny classname joiner.
   Filters out falsy parts and space-joins the rest. Shared across the
   app so we don't re-declare the same helper in every component. No
   external dependency (no clsx/classnames) — keeps the bundle lean.
   ════════════════════════════════════════════════════════════════════ */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
