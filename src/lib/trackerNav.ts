/**
 * Tracker → dedicated-screen mapping (Phase 6, IA glue).
 *
 * The unified dashboard and the Goals hub both deep-link each tracker into its
 * first-class screen (built in Phases 2–5). This is the single source of truth
 * for that routing so the dashboard, hub, and FAB quick-log stay consistent.
 *
 *   exercise → /goals/training   (training schedule + streak)
 *   diet     → /diet             (macros)
 *   bible    → /bible            (daily reading)
 *   custom   → /trackers         (custom-habit CRUD)
 */

import type { TrackerType } from "@/lib/types";

/** Default emoji per type when a tracker has no icon of its own. */
export const TYPE_ICON: Record<TrackerType, string> = {
  exercise: "🏔️",
  diet: "🥗",
  bible: "📖",
  custom: "🎯",
};

/** Short display label per type. */
export const TYPE_LABEL: Record<TrackerType, string> = {
  exercise: "Training",
  diet: "Nutrition",
  bible: "Bible",
  custom: "Custom",
};

/** The dedicated screen a tracker of this type deep-links into. */
export function trackerHref(type: TrackerType): string {
  switch (type) {
    case "exercise":
      return "/goals/training";
    case "diet":
      return "/diet";
    case "bible":
      return "/bible";
    case "custom":
    default:
      return "/trackers";
  }
}

/** Display icon for a tracker: its own icon, else the type default. */
export function trackerIcon(type: TrackerType, icon: string | null | undefined): string {
  return (icon && icon.trim()) || TYPE_ICON[type] || "🎯";
}
