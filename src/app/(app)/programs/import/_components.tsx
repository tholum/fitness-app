"use client";

/* ════════════════════════════════════════════════════════════════════
   IMPORT / EXPORT — client subcomponents (gap 8).
   • ImportPanel: a desktop-first uploader (file input + drag-drop) that
     reads a .json file, parses it client-side, validates the basic shape,
     previews the program → days → blocks → exercises tree, then submits the
     parsed payload to the importProgram server action.
   • ExportPanel: pick an owned program, call exportProgram, and download the
     returned tree as a .json file.
   The accepted schema is documented in-page. Styling is strictly theme-token
   Tailwind; primitives from src/components/ui.tsx.
   ════════════════════════════════════════════════════════════════════ */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

/* ── shared shapes (kept local so the file is self-contained) ─────────── */
export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface ImportExercise {
  name?: string;
  sets?: number | string | null;
  reps?: string | null;
  load?: string | null;
  distance?: string | null;
  time?: string | null;
  rest?: string | null;
  notes?: string | null;
  order?: number;
}
export interface ImportBlock {
  label?: string;
  type?: string;
  detail?: string | null;
  order?: number;
  exercises?: ImportExercise[];
}
export interface ImportDay {
  phase?: number;
  week?: number;
  day?: number;
  title?: string;
  est_minutes?: number | string | null;
  video_url?: string | null;
  order?: number;
  blocks?: ImportBlock[];
}
export interface ImportPayload {
  name?: string;
  source?: string;
  days?: ImportDay[];
}

/** Export shape (what exportProgram returns; same schema importProgram reads). */
export type ProgramExport = Required<Pick<ImportPayload, "name" | "source">> & {
  days: ImportDay[];
};

export interface ExportableProgram {
  id: string;
  name: string;
}

export type ImportFn = (payload: ImportPayload) => Promise<ActionResult<{ id: string }>>;
export type ExportFn = (programId: string) => Promise<ActionResult<{ program: ProgramExport }>>;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-2 font-cond text-xs font-semibold uppercase tracking-wide text-danger">
      {message}
    </p>
  );
}

/* ── basic shape validation + light normalization for the preview ─────── */
function validate(raw: unknown): { ok: true; payload: ImportPayload } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Top level must be a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    return { ok: false, error: 'Missing required "name" (string).' };
  }
  if (!Array.isArray(obj.days)) {
    return { ok: false, error: 'Missing required "days" (array).' };
  }
  return { ok: true, payload: obj as ImportPayload };
}

function countTree(p: ImportPayload): { days: number; blocks: number; exercises: number } {
  let blocks = 0;
  let exercises = 0;
  for (const d of p.days ?? []) {
    for (const b of d.blocks ?? []) {
      blocks += 1;
      exercises += (b.exercises ?? []).length;
    }
  }
  return { days: (p.days ?? []).length, blocks, exercises };
}

/* ════════════════════════════════════════════════════════════════════
   ImportPanel
   ════════════════════════════════════════════════════════════════════ */

const SCHEMA_SAMPLE = `{
  "name": "My Program",
  "source": "custom",
  "days": [
    {
      "phase": 1, "week": 1, "day": 1,
      "title": "Lower Strength",
      "est_minutes": 60,
      "video_url": "https://mtntough.com/...",
      "blocks": [
        {
          "label": "Main Strength", "type": "strength",
          "detail": "Heavy",
          "exercises": [
            { "name": "Back Squat", "sets": 5, "reps": "5",
              "load": "RPE 8", "rest": "120s", "notes": "" }
          ]
        }
      ]
    }
  ]
}`;

export function ImportPanel({ importAction }: { importAction: ImportFn }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ImportPayload | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function readFile(file: File) {
    setError(null);
    setDone(false);
    setParsed(null);
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setError("Please choose a .json file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(reader.result));
      } catch {
        setError("That file isn't valid JSON.");
        return;
      }
      const res = validate(raw);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setParsed(res.payload);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function onConfirm() {
    if (!parsed) return;
    setError(null);
    startTransition(async () => {
      const res = await importAction(parsed);
      if (!res.ok || !res.data) {
        setError(res.error ?? "Import failed.");
        return;
      }
      setDone(true);
      router.push(`/programs/${res.data.id}`);
    });
  }

  function reset() {
    setParsed(null);
    setFileName(null);
    setError(null);
    setDone(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const counts = parsed ? countTree(parsed) : null;

  return (
    <Card className="p-4">
      {/* Schema docs */}
      <button
        type="button"
        onClick={() => setShowSchema((v) => !v)}
        className="mb-3 flex w-full items-center justify-between gap-2 rounded-[12px] border border-line bg-surface2 px-3.5 py-2.5 text-left"
      >
        <span className="font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
          JSON schema
        </span>
        <svg
          viewBox="0 0 24 24"
          className={cx(
            "h-4 w-4 fill-none stroke-muted [stroke-width:2] transition-transform",
            showSchema && "rotate-180",
          )}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {showSchema ? (
        <div className="mb-3">
          <p className="mb-2 text-xs text-muted">
            A program is an object with a <code className="text-text">name</code> and a{" "}
            <code className="text-text">days[]</code> array. Each day has{" "}
            <code className="text-text">phase/week/day/title</code> and a{" "}
            <code className="text-text">blocks[]</code> array; each block has{" "}
            <code className="text-text">label/type</code> and an{" "}
            <code className="text-text">exercises[]</code> array. Block{" "}
            <code className="text-text">type</code> is one of warmup, strength,
            conditioning, mobility, other.
          </p>
          <pre className="no-scrollbar overflow-x-auto rounded-[12px] border border-line bg-bg2 p-3 font-mono text-[11px] leading-relaxed text-muted">
            {SCHEMA_SAMPLE}
          </pre>
        </div>
      ) : null}

      {/* Dropzone */}
      {!parsed ? (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) readFile(file);
            }}
            className={cx(
              "flex w-full flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed px-4 py-10 text-center transition-colors",
              dragOver ? "border-accent bg-accent/[0.08]" : "border-line-solid bg-surface",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8 fill-none stroke-muted [stroke-width:1.8]"
            >
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-text">
              Choose or drop a .json file
            </span>
            <span className="text-xs text-faint">
              Parsed in your browser — nothing uploads until you confirm.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
          <ErrorNote message={error} />
        </>
      ) : (
        <>
          {/* Preview */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.03em] text-text">
                {parsed.name}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {fileName ? `${fileName} · ` : ""}
                {counts?.days} days · {counts?.blocks} blocks · {counts?.exercises} exercises
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="flex-shrink-0 rounded-full border border-line bg-surface2 px-3 py-2 font-cond text-[10px] font-semibold uppercase tracking-wide text-muted"
            >
              Clear
            </button>
          </div>

          <TreePreview payload={parsed} />

          <ErrorNote message={error} />
          {done ? null : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="mt-3 w-full rounded-[16px] bg-grad px-4 py-3.5 font-display text-[15px] font-semibold uppercase tracking-[0.094em] text-bg shadow-[0_8px_24px_rgba(200,98,45,.3)] disabled:opacity-60"
            >
              {pending ? "Importing…" : "Import this program"}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function TreePreview({ payload }: { payload: ImportPayload }) {
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto rounded-[12px] border border-line bg-bg2 p-3">
      {(payload.days ?? []).map((d, di) => (
        <div key={di} className="rounded-[10px] border border-line bg-surface2 p-2.5">
          <div className="flex items-center gap-2">
            <span className="font-display text-[13px] font-semibold uppercase tracking-wide text-text">
              {d.title ?? `Day ${di + 1}`}
            </span>
            <span className="font-cond text-[10px] uppercase tracking-wide text-faint">
              P{d.phase ?? 1}·W{d.week ?? 1}·D{d.day ?? di + 1}
            </span>
          </div>
          {(d.blocks ?? []).map((b, bi) => (
            <div key={bi} className="mt-1.5 pl-2">
              <div className="font-cond text-[11px] font-semibold uppercase tracking-wide text-gold">
                {b.label ?? `Block ${bi + 1}`}
                <span className="ml-1 text-faint">({b.type ?? "strength"})</span>
              </div>
              <ul className="mt-0.5 space-y-0.5 pl-2">
                {(b.exercises ?? []).map((x, xi) => (
                  <li key={xi} className="text-xs text-muted">
                    • {x.name ?? `Exercise ${xi + 1}`}
                    {x.sets != null || x.reps ? (
                      <span className="text-faint">
                        {" "}
                        — {x.sets != null ? `${x.sets}×` : ""}
                        {x.reps ?? ""}
                      </span>
                    ) : null}
                  </li>
                ))}
                {(b.exercises ?? []).length === 0 ? (
                  <li className="text-xs text-faint">• (no exercises)</li>
                ) : null}
              </ul>
            </div>
          ))}
          {(d.blocks ?? []).length === 0 ? (
            <div className="mt-1 pl-2 text-xs text-faint">(no blocks)</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ExportPanel
   ════════════════════════════════════════════════════════════════════ */

export function ExportPanel({
  programs,
  exportAction,
}: {
  programs: ExportableProgram[];
  exportAction: ExportFn;
}) {
  const [selected, setSelected] = useState<string>(programs[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function download() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await exportAction(selected);
      if (!res.ok || !res.data) {
        setError(res.error ?? "Export failed.");
        return;
      }
      const json = JSON.stringify(res.data.program, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (res.data.program.name || "program")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      a.href = url;
      a.download = `${safe || "program"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  if (programs.length === 0) {
    return (
      <Card className="p-5 text-center">
        <p className="text-[13px] text-muted">
          You don&apos;t own any programs to export yet. Create or copy one
          first.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <label className="block">
        <span className="mb-1.5 block font-cond text-[11px] font-semibold uppercase tracking-wide text-muted">
          Program
        </span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full appearance-none rounded-[14px] border border-line bg-bg2 px-3.5 py-3 font-display text-base text-text outline-none focus:border-accent"
        >
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={download}
        disabled={pending || !selected}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] border border-line bg-surface2 px-4 py-3 font-display text-[13px] font-semibold uppercase tracking-wide text-text disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current [stroke-width:1.9]">
          <path d="M12 4v12M7 11l5 5 5-5" />
          <path d="M4 20h16" />
        </svg>
        {pending ? "Preparing…" : "Download JSON"}
      </button>
      <ErrorNote message={error} />
    </Card>
  );
}
