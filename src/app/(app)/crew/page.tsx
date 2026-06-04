import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getCrewToday,
  getFeed,
  listMyCrews,
  type FeedItem,
} from "@/lib/queries";
import { startOfWeekISO, todayISO } from "@/lib/format";
import { Card, SectionHeader } from "@/components/ui";
import {
  Reactions,
  NudgeButton,
  InviteCode,
  CrewOnboarding,
  CrewSwitcher,
  CrewMenu,
  RemoveMemberButton,
  NoteComposer,
} from "./_components";

/* ════════════════════════════════════════════════════════════════════
   CREW — cooperative crew screen (NO competitive leaderboard)
   ─────────────────────────────────────────────────────────────────────
   • Empty state: a real two-choice onboarding card (create / join code).
   • Header: a crew SWITCHER (active crew name → setActiveCrew) plus an
     overflow settings MENU (join another / leave / — owner: edit) and the
     existing invite affordance.
   • Top card: this week's SHARED goal progress + "X of N trained today".
   • Member list: each member's week count + streak as SUPPORTIVE status
     (✓ done today / not yet) — never ranked. Creator sees per-member
     "Remove".
   • Activity feed: a note COMPOSER (postNote) atop feed_posts with
     reaction chips (👊🔥💬) and nudges.

   The shared queries (getCrewToday/getFeed) don't expose per-member week
   counts or streaks, so a small local helper reads those here rather than
   editing the shared data layer.
   ════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const REACTION_EMOJIS = ["👊", "🔥", "💬"] as const;

// ── Avatar palette (deterministic per member) ───────────────────────────
const AV_COLORS = ["#7a8b52", "#c8622d", "#d9a441", "#5a7d8c", "#b5483a"] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const FEED_KIND_LABEL: Record<string, { icon: string; verb: string }> = {
  session: { icon: "✓", verb: "completed a session" },
  pr: { icon: "🏆", verb: "hit a PR" },
  badge: { icon: "🎖️", verb: "earned a badge" },
  note: { icon: "📝", verb: "posted" },
};

// ── Local helper: per-member week count + streak, and crew weekly total ──
interface MemberStats {
  weekCount: number;
  streak: number;
}

interface CrewWeek {
  byUser: Map<string, MemberStats>;
  crewTotal: number;
}

/**
 * Compute, for each member, how many sessions they've completed since the
 * start of this week plus their current daily streak. Also returns the
 * crew-wide weekly session total (sum of member week counts).
 *
 * Reads completed session_logs for the whole crew in one query; RLS lets a
 * member read crew-mates' shared completed logs. Tolerates an empty DB.
 */
async function getCrewWeek(memberIds: string[]): Promise<CrewWeek> {
  const byUser = new Map<string, MemberStats>();
  for (const id of memberIds) byUser.set(id, { weekCount: 0, streak: 0 });
  if (memberIds.length === 0) return { byUser, crewTotal: 0 };

  const supabase = await createClient();
  const weekStart = startOfWeekISO();

  // Pull completed logs (date only). A ~60-day window is plenty for streaks
  // and keeps the payload small on an active crew.
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 60);
  const windowISO = `${windowStart.getFullYear()}-${String(windowStart.getMonth() + 1).padStart(2, "0")}-${String(windowStart.getDate()).padStart(2, "0")}`;

  const { data } = await supabase
    .from("session_logs")
    .select("user_id, date")
    .in("user_id", memberIds)
    .eq("completed", true)
    .gte("date", windowISO);

  const datesByUser = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{ user_id: string; date: string }>) {
    const set = datesByUser.get(row.user_id) ?? new Set<string>();
    set.add(row.date);
    datesByUser.set(row.user_id, set);
  }

  let crewTotal = 0;
  for (const id of memberIds) {
    const dates = datesByUser.get(id) ?? new Set<string>();
    // Week count: distinct completed days since week start.
    let weekCount = 0;
    for (const d of dates) if (d >= weekStart) weekCount += 1;
    crewTotal += weekCount;

    // Streak: consecutive days back from today (or yesterday) with a log.
    let streak = 0;
    const cursor = new Date();
    // Allow the streak to be "alive" if today isn't done yet but yesterday was.
    if (!dates.has(todayISO())) cursor.setDate(cursor.getDate() - 1);
    for (;;) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (dates.has(iso)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    byUser.set(id, { weekCount, streak });
  }

  return { byUser, crewTotal };
}

// ── Reaction state for the feed (per post / per emoji, with "mine") ──────
function reactionStateFor(item: FeedItem, meId: string | null) {
  const state: Record<string, { count: number; mine: boolean }> = {};
  for (const emoji of REACTION_EMOJIS) state[emoji] = { count: 0, mine: false };
  for (const r of item.reactions) {
    const slot = state[r.emoji] ?? (state[r.emoji] = { count: 0, mine: false });
    slot.count += 1;
    if (meId && r.user_id === meId) slot.mine = true;
  }
  return state;
}

// ── Small presentational bits ───────────────────────────────────────────
function Avatar({ name, userId, size = 38 }: { name: string; userId: string; size?: number }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full font-display font-bold text-bg"
      style={{
        width: size,
        height: size,
        background: avColor(userId),
        fontSize: Math.round(size * 0.37),
      }}
    >
      {initials(name)}
    </div>
  );
}

export default async function CrewPage() {
  const [profile, crewToday, myCrews] = await Promise.all([
    getProfile(),
    getCrewToday(),
    listMyCrews(),
  ]);
  const { crew, members, trainedCount, totalCount } = crewToday;

  // ── Empty state: not in a crew yet — real two-choice onboarding ───────
  if (!crew) {
    return (
      <>
        <Header subtitle="Cooperative training" title="Crew" />
        <CrewOnboarding />
      </>
    );
  }

  const memberIds = members.map((m) => m.user_id);
  const [{ byUser, crewTotal }, feed] = await Promise.all([
    getCrewWeek(memberIds),
    getFeed(crew.id),
  ]);

  const meId = profile?.id ?? null;
  const isOwner = meId != null && crew.created_by === meId;
  const goalTotal = crew.weekly_goal * Math.max(1, totalCount);
  const goalPct = goalTotal > 0 ? Math.min(100, Math.round((crewTotal / goalTotal) * 100)) : 0;

  // Sort members for a friendly (non-competitive) read: trained-today first,
  // then by name. This is presentation only — no ranks are shown.
  const orderedMembers = [...members].sort((a, b) => {
    if (a.trainedToday !== b.trainedToday) return a.trainedToday ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
  const notTrained = orderedMembers.filter((m) => !m.trainedToday && m.user_id !== meId);

  return (
    <>
      <Header
        subtitle={`${totalCount} ${totalCount === 1 ? "athlete" : "athletes"} · this week`}
        title={crew.name}
        titleNode={
          <CrewSwitcher
            crews={myCrews}
            activeCrewId={crew.id}
            activeName={crew.name}
            meId={meId}
          />
        }
        action={
          <CrewMenu
            crewId={crew.id}
            crewName={crew.name}
            weeklyGoal={crew.weekly_goal}
            isOwner={isOwner}
          />
        }
      />

      {/* ── Shared weekly goal + trained-today ───────────────────────── */}
      <Card className="mb-3.5 bg-grad p-5 text-bg">
        <div className="font-cond text-[11px] font-bold uppercase tracking-[0.18em] opacity-80">
          {crew.name} · This Week
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div className="font-display text-[28px] font-bold uppercase leading-none">
            {crewTotal} <span className="opacity-70">/ {goalTotal}</span>
          </div>
          <div className="font-display text-sm font-semibold uppercase tracking-wide opacity-85">
            sessions
          </div>
        </div>
        {/* Progress bar (on-gradient, dark fill for contrast). */}
        <div className="mt-3 h-2.5 overflow-hidden rounded-md bg-bg/25">
          <div
            className="h-full rounded-md bg-bg/85"
            style={{ width: `${goalPct}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex">
            {orderedMembers.slice(0, 4).map((m, i) => (
              <div
                key={m.user_id}
                className="-ml-2 first:ml-0"
                style={{ zIndex: 4 - i }}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full font-display text-[11px] font-bold"
                  style={{
                    background: avColor(m.user_id),
                    color: "var(--bg)",
                    border: "2px solid var(--bg)",
                    opacity: m.trainedToday ? 1 : 0.55,
                  }}
                >
                  {initials(m.display_name)}
                </div>
              </div>
            ))}
          </div>
          <div className="font-display text-sm font-semibold uppercase tracking-wide">
            {trainedCount} of {totalCount} trained today
          </div>
        </div>
      </Card>

      {/* ── Nudge prompts (anyone not trained today) ─────────────────── */}
      {notTrained.length > 0 ? (
        <>
          <SectionHeader>Give a nudge</SectionHeader>
          {notTrained.map((m) => {
            const stats = byUser.get(m.user_id);
            return (
              <Card
                key={m.user_id}
                className="mb-2.5 flex items-center gap-3 border-dashed border-line-solid p-3.5"
              >
                <Avatar name={m.display_name} userId={m.user_id} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-semibold uppercase tracking-wide text-text">
                    {m.display_name} hasn&apos;t trained today
                  </div>
                  <div className="text-xs text-muted">
                    {stats && stats.weekCount > 0
                      ? `${stats.weekCount} this week · cheer them on`
                      : "Send some encouragement"}
                  </div>
                </div>
                <NudgeButton toUser={m.user_id} crewId={crew.id} />
              </Card>
            );
          })}
        </>
      ) : null}

      {/* ── Crew roster (supportive status, never ranked) ────────────── */}
      <SectionHeader>This Week&apos;s Crew</SectionHeader>
      <Card className="mb-1">
        {orderedMembers.map((m, i) => {
          const stats = byUser.get(m.user_id) ?? { weekCount: 0, streak: 0 };
          const isMe = m.user_id === meId;
          // The creator can remove others; never themselves.
          const canRemove = isOwner && !isMe;
          return (
            <div
              key={m.user_id}
              className={`flex items-center gap-3 px-3.5 py-3 ${
                i < orderedMembers.length - 1 ? "border-b border-line" : ""
              } ${isMe ? "bg-accent/10" : ""}`}
            >
              <Avatar name={m.display_name} userId={m.user_id} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-medium uppercase tracking-wide text-text">
                  {isMe ? "You" : m.display_name}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {stats.weekCount} {stats.weekCount === 1 ? "session" : "sessions"} this week
                  {stats.streak > 0 ? ` · 🔥 ${stats.streak}` : ""}
                </div>
              </div>
              {m.trainedToday ? (
                <span className="flex items-center gap-1 font-display text-xs font-semibold uppercase tracking-wide text-accent2">
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden
                    className="h-4 w-4 fill-none stroke-accent2 [stroke-width:3]"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  Done
                </span>
              ) : isMe ? (
                <span className="font-cond text-[11px] font-semibold uppercase tracking-wide text-faint">
                  Not yet
                </span>
              ) : (
                <NudgeButton toUser={m.user_id} crewId={crew.id} />
              )}
              {canRemove ? (
                <RemoveMemberButton
                  crewId={crew.id}
                  userId={m.user_id}
                  name={m.display_name}
                />
              ) : null}
            </div>
          );
        })}
      </Card>

      {/* ── Invite affordance (exposes invite_code) ──────────────────── */}
      <div className="mt-3.5">
        <InviteCode code={crew.invite_code} />
      </div>

      {/* ── Activity feed ────────────────────────────────────────────── */}
      <SectionHeader>Activity</SectionHeader>
      <NoteComposer crewId={crew.id} />
      {feed.length === 0 ? (
        <Card className="p-5 text-center text-sm text-muted">
          No activity yet. Post some encouragement above, or complete a session
          and share it to kick off the feed.
        </Card>
      ) : (
        feed.map((item) => {
          const author = item.author?.display_name ?? "Athlete";
          const meta = FEED_KIND_LABEL[item.kind] ?? FEED_KIND_LABEL.note;
          return (
            <Card key={item.id} className="mb-2.5 p-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={author} userId={item.user_id} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-semibold uppercase tracking-wide text-text">
                    {author}
                  </div>
                  <div className="text-[11px] text-faint">
                    {timeAgo(item.created_at)} · {meta.verb}
                  </div>
                </div>
              </div>

              {item.body ? (
                <p className="mt-2.5 text-[13px] text-text">{item.body}</p>
              ) : null}

              {item.kind !== "note" ? (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs">
                  {meta.icon}
                  <b className="font-display font-semibold uppercase tracking-wide">
                    {item.body ? meta.verb : author}
                  </b>
                </span>
              ) : null}

              <Reactions postId={item.id} initial={reactionStateFor(item, meId)} />
            </Card>
          );
        })
      )}
    </>
  );
}

// ── Page header (ported from the prototype's .hd) ───────────────────────
function Header({
  subtitle,
  title,
  titleNode,
  action,
}: {
  subtitle: string;
  title: string;
  /** Optional interactive title (e.g. the CrewSwitcher); falls back to text. */
  titleNode?: React.ReactNode;
  /** Optional trailing control (e.g. the CrewMenu). */
  action?: React.ReactNode;
}) {
  return (
    <div className="relative z-[1] flex items-start justify-between px-0.5 pb-[18px] pt-2">
      <div className="min-w-0">
        <div className="font-cond text-[11px] uppercase tracking-[0.18em] text-muted">
          {subtitle}
        </div>
        {titleNode ?? (
          <h1 className="mt-[3px] font-display text-3xl font-bold uppercase leading-none tracking-wide text-text">
            {title}
          </h1>
        )}
      </div>
      {action ? <div className="flex-shrink-0 pt-1">{action}</div> : null}
    </div>
  );
}
