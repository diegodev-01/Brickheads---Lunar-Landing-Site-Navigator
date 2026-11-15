"use client";

import { useState } from "react";
import type { CellEvaluation } from "@/domain/scoring/evaluate";
import { gatePhrase, type CellExplanation, type Readiness } from "@/domain/scoring/explainCell";

const TONE: Record<Readiness, { ring: string; text: string; icon: string }> = {
  good: { ring: "border-good/60", text: "text-good", icon: "✓" },
  possible: { ring: "border-warn/60", text: "text-warn", icon: "~" },
  poor: { ring: "border-bad/60", text: "text-bad", icon: "✗" },
  excluded: { ring: "border-bad/70", text: "text-bad", icon: "⛔" },
};

const REASON_TONE = { good: "text-good", warn: "text-warn", bad: "text-bad", info: "text-muted" };

const CONF_TEXT = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
const CONF_BARS = { high: "▮▮▮", medium: "▮▮▯", low: "▮▯▯" };

/** Headline + 3–4 plain reasons + confidence; factor contributions and gates one click deeper. */
export function ReadinessCard({
  evaluation,
  explanation,
  title,
}: {
  evaluation: CellEvaluation;
  explanation: CellExplanation;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = TONE[explanation.readiness];
  return (
    <section
      className={`mx-3 my-3 rounded-md border-2 ${t.ring} bg-panel-2 px-3 py-2.5`}
      aria-label="Readiness summary"
    >
      {title && <div className="text-[11px] tracking-wider text-muted uppercase">{title}</div>}
      <div className="flex items-start justify-between gap-2">
        <h2 className={`text-base font-semibold ${t.text}`}>
          <span aria-hidden="true">{t.icon} </span>
          {explanation.headline}
        </h2>
        <div className="text-right">
          <div className="font-mono text-xl leading-none">{explanation.scoreText}</div>
          {evaluation.passed && (
            <div
              className="text-[10px] text-muted"
              title="Uncertainty from data provenance: measured and derived inputs are more certain than simulated ones."
            >
              <span aria-hidden="true">{CONF_BARS[explanation.confidence]} </span>
              {CONF_TEXT[explanation.confidence]}
            </div>
          )}
        </div>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[13px]">
        {explanation.reasons.map((r) => (
          <li key={r.text} className="flex gap-1.5">
            <span aria-hidden="true" className={REASON_TONE[r.tone]}>
              {r.icon}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2 text-[11px] text-muted underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-sun"
      >
        {open ? "Hide details" : "Why? Show the numbers"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-muted">{explanation.sentence}</p>
          {evaluation.passed && (
            <div className="space-y-1">
              {explanation.contributions.map((c) => (
                <div key={c.id} className="grid grid-cols-[96px_1fr_58px] items-center gap-2">
                  <span>{c.label}</span>
                  <span className="h-2 overflow-hidden rounded bg-line" aria-hidden="true">
                    <span
                      className="block h-full bg-sun"
                      style={{ width: `${c.normalized * 100}%` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[11px]">
                    +{c.points.toFixed(1)}
                    <span className="text-muted"> ×{Math.round(c.weight * 100)}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="space-y-0.5">
            {evaluation.gates.map((g) => (
              <li key={g.id} className={g.passed ? "text-muted" : "text-bad"}>
                {g.passed ? "✓" : "✗"} {g.id}
                {g.simulated ? " ◇" : ""}: {g.passed ? "passed" : gatePhrase(g)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
