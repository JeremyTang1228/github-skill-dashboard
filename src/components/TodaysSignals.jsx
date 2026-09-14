import React from "react";
import { Flame, TrendingUp, Gem, Sparkles } from "lucide-react";
import { formatNumber } from "../lib/data.js";

const GROUPS = [
  { key: "breakout", filter: "BREAKOUT", label: "Breakouts", hint: "Accelerating fastest right now", Icon: Flame },
  { key: "fastGrowing", filter: "FAST_GROWING", label: "Fast Growing", hint: "Building sustained momentum", Icon: TrendingUp },
  { key: "hiddenGems", filter: "HIDDEN_GEM", label: "Hidden Gems", hint: "Small, with strong early signal", Icon: Gem },
  { key: "newProjects", filter: "NEW", label: "New Projects", hint: "Recently created, worth watching", Icon: Sparkles }
];

export function TodaysSignals({ counts, onPickFilter, stats }) {
  return (
    <section className="signals-section" id="signals" aria-label="Today's signals">
      <div className="section-heading">
        <span className="eyebrow">Today&apos;s Signals</span>
        <p>What the Momentum Engine is flagging right now — computed from real growth history, never guessed.</p>
      </div>

      <div className="signal-tiles">
        {GROUPS.map((group) => {
          const count = counts[group.key] || 0;
          const isEmpty = count === 0;
          return (
            <button
              key={group.key}
              type="button"
              className={isEmpty ? "signal-tile disabled" : "signal-tile"}
              disabled={isEmpty}
              onClick={() => onPickFilter(group.filter)}
              title={isEmpty ? `${group.label}: no signals yet` : group.hint}
            >
              <group.Icon size={15} strokeWidth={1.75} className={`signal-tile-icon ${group.key}`} />
              <span className="signal-tile-count">{count}</span>
              <span className="signal-tile-label">{group.label}</span>
            </button>
          );
        })}
      </div>

      <div className="signals-empty">
        <p>
          The radar hasn&apos;t classified any Breakout, Fast Growing or Hidden Gem signals yet — that
          takes at least two days of snapshot history, and this dataset only has one so far.
        </p>
        <p className="signals-empty-meta">
          {formatNumber(stats?.totalRepositories)} repositories are already being tracked, averaging a
          momentum score of {stats?.averageMomentumScore ?? "—"}. Signals will appear automatically as
          history accumulates — nothing here is estimated in the meantime.
        </p>
      </div>
    </section>
  );
}
