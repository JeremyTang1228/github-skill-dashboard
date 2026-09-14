import React from "react";
import { SIGNAL_META, LIFECYCLE_META, formatNumber, momentumBand } from "../lib/data.js";

/** Small uppercase tag for the radar classification. Renders nothing if the
 *  backend hasn't classified this repo yet — we never invent a signal. */
export function SignalBadge({ signalType, lifecycleType, compact }) {
  const signal = signalType ? SIGNAL_META[signalType] : null;
  const life = lifecycleType ? LIFECYCLE_META[lifecycleType] : null;
  if (!signal && !life) return null;

  return (
    <span className={`badge-row${compact ? " compact" : ""}`}>
      {signal ? <span className={`signal-badge ${signal.cls}`}>{signal.label}</span> : null}
      {life && life.cls !== "established" ? (
        <span className={`signal-badge ${life.cls}`}>{life.label}</span>
      ) : null}
    </span>
  );
}

/** The product's core visual anchor: a large tabular-figure number with a
 *  thin strength meter beneath it, deliberately not styled like a stock
 *  ticker (no up/down arrows, no red/green flash). */
export function MomentumScore({ score, size = "md" }) {
  const value = score === null || score === undefined ? null : Number(score);
  const band = momentumBand(value ?? 0);

  return (
    <div className={`momentum-score momentum-${size} band-${band}`}>
      <span className="momentum-value">{value === null ? "—" : Math.round(value)}</span>
      <span className="momentum-label">Momentum</span>
      <span className="momentum-meter" aria-hidden="true">
        <span className="momentum-meter-fill" style={{ width: `${Math.max(2, Math.min(100, value ?? 0))}%` }} />
      </span>
    </div>
  );
}

/** owner/repo styled with the owner segment dimmed — a small, cheap way to
 *  read more like a developer tool than an editorial byline. */
export function RepoName({ fullName, as: Tag = "span" }) {
  const [owner, repo] = (fullName || "").split("/");
  if (!repo) return <Tag>{fullName}</Tag>;
  return (
    <Tag>
      <span className="repo-name-owner">{owner}/</span>
      {repo}
    </Tag>
  );
}

export function ComponentBar({ label, value }) {
  const v = value === null || value === undefined ? null : Number(value);
  return (
    <div className="component-bar">
      <span className="component-label">{label}</span>
      <span className="component-track">
        <span className="component-fill" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
      </span>
      <span className="component-value">{v === null ? "—" : Math.round(v)}</span>
    </div>
  );
}
