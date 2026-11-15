"use client";

import type { Aim } from "@/domain/orbit/aim";
import type { PlainRating, PlainRow, PlainSummary } from "@/domain/scoring/plainSummary";
import { formatLonLat } from "@/features/planisphere/format";

export interface BestSpot {
  letter: string;
  score: number;
  onGo: () => void;
}

interface Props {
  aim: Aim;
  /** Null while the answer is being computed. */
  summary: PlainSummary | null;
  /** Top places for the current dates (empty while computing or when none passes). */
  best: BestSpot[];
  bestReady: boolean;
  onOpenDetail: () => void;
}

const TONE: Record<PlainSummary["readiness"], { box: string; text: string; icon: string }> = {
  good: { box: "border-good bg-good/10", text: "text-good", icon: "✓" },
  possible: { box: "border-warn bg-warn/10", text: "text-warn", icon: "!" },
  poor: { box: "border-bad bg-bad/10", text: "text-bad", icon: "✗" },
  excluded: { box: "border-bad bg-bad/10", text: "text-bad", icon: "⛔" },
  unknown: { box: "border-line bg-panel-2", text: "text-foreground", icon: "?" },
};

const RATING: Record<PlainRating, { text: string; bar: string }> = {
  great: { text: "text-good", bar: "bg-good" },
  ok: { text: "text-warn", bar: "bg-warn" },
  weak: { text: "text-bad", bar: "bg-bad" },
  blocked: { text: "text-bad", bar: "bg-bad" },
  unknown: { text: "text-muted", bar: "bg-muted" },
};

const ICON: Record<PlainRow["id"], string> = {
  safety: "⛰️",
  power: "☀️",
  comms: "📡",
  science: "🧊",
};

/** The answer for a non-technical reader: one verdict, four rated questions, the best 3 spots. */
export function SimpleResults({ aim, summary, best, bestReady, onOpenDetail }: Props) {
  return (
    <div className="space-y-4 px-4 py-4">
      <section aria-label="Result for your landing point" aria-live="polite">
        <p className="text-[11px] tracking-[0.12em] text-muted uppercase">Your landing point</p>
        <p className="font-mono text-sm">{formatLonLat(aim)}</p>

        {!summary ? (
          <p className="mt-3 text-sm text-muted" role="status">
            Checking this spot for your dates…
          </p>
        ) : (
          <>
            <div className={`mt-2 rounded-lg border-2 px-3 py-3 ${TONE[summary.readiness].box}`}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-current text-xl font-bold ${TONE[summary.readiness].text}`}
                >
                  {TONE[summary.readiness].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    className={`text-lg leading-tight font-semibold ${TONE[summary.readiness].text}`}
                  >
                    {summary.verdict}
                  </h2>
                  <p className="text-[13px] leading-snug">{summary.advice}</p>
                </div>
                {summary.score !== null && (
                  <div className="text-right leading-none">
                    <div className="font-mono text-2xl font-semibold">{summary.score}</div>
                    <div className="text-[10px] text-muted">out of 100</div>
                  </div>
                )}
              </div>
            </div>

            <ul className="mt-3 space-y-2.5">
              {summary.rows.map((r) => (
                <li key={r.id} className="grid grid-cols-[1.75rem_1fr] gap-x-2">
                  <span aria-hidden="true" className="text-lg leading-6">
                    {ICON[r.id]}
                  </span>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.title}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="flex gap-0.5" aria-hidden="true">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <span
                              key={i}
                              className={`h-2 w-3 rounded-sm ${i <= r.stars ? RATING[r.rating].bar : "bg-line"}`}
                            />
                          ))}
                        </span>
                        <span
                          className={`w-14 text-right text-xs font-semibold ${RATING[r.rating].text}`}
                        >
                          {r.ratingWord}
                        </span>
                      </span>
                    </div>
                    <p className="text-[13px] leading-snug text-muted">{r.text}</p>
                  </div>
                </li>
              ))}
            </ul>

            {summary.readiness === "unknown" && (
              <button
                type="button"
                onClick={onOpenDetail}
                className="mt-3 w-full rounded border border-sun/70 bg-sun/10 px-3 py-1.5 text-sm font-medium text-sun hover:bg-sun/20 focus-visible:outline-2 focus-visible:outline-sun"
              >
                Go to the south pole zone for a full check →
              </button>
            )}
          </>
        )}
      </section>

      <section aria-label="Best places to land" className="border-t border-line pt-3">
        <h2 className="text-sm font-semibold">Best 3 places to land on your dates</h2>
        {!bestReady ? (
          <p className="mt-1 text-[13px] text-muted" role="status">
            Searching the south pole zone…
          </p>
        ) : best.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted">
            No spot passes every safety check on these dates. Try another landing date.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {best.map((b) => (
              <li key={b.letter}>
                <button
                  type="button"
                  onClick={b.onGo}
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-left hover:border-sun focus-visible:outline-2 focus-visible:outline-sun"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 place-items-center rounded-full bg-sun text-sm font-bold text-background"
                  >
                    {b.letter}
                  </span>
                  <span className="flex-1 text-sm">Spot {b.letter}</span>
                  <span className="font-mono text-sm">
                    {Math.round(b.score)}
                    <span className="text-[10px] text-muted"> / 100</span>
                  </span>
                  <span className="text-xs text-sun">Go there →</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
