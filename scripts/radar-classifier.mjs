// =============================================================================
// radar-classifier.mjs
// GitHub Radar — V1.1 Radar Classification (signal + lifecycle layer)
//
// Pure, dependency-free classifier. It turns a repository's already-computed
// `radar` object (Momentum Score, growth deltas, components) plus its raw
// stars / age into:
//   * signalType   : BREAKOUT | FAST_GROWING | HIDDEN_GEM | WATCH   (single, primary)
//   * lifecycleType: NEW | EMERGING | ESTABLISHED                    (independent axis)
//   * confidence   : 0..1, honesty about how much history backs the call
//
// Design rules (from the V1.1 spec):
//   * NO growth-based signal (BREAKOUT / FAST_GROWING / HIDDEN_GEM) may be
//     assigned without POSITIVE growth actually being measured. This is the
//     key guard against "false high scores" when only 1-2 daily snapshots
//     exist: with no history, growth deltas are null, so none of those
//     signals can fire — every repo falls back to WATCH.
//   * signalType and lifecycleType are independent: a repo can be
//     BREAKOUT + NEW at the same time.
//   * confidence is LOW when history is thin, so the UI never pretends to
//     know more than the data supports.
// =============================================================================

import { daysBetween } from "./momentum-engine.mjs";

export const SIGNAL = {
  BREAKOUT: "BREAKOUT",
  FAST_GROWING: "FAST_GROWING",
  HIDDEN_GEM: "HIDDEN_GEM",
  WATCH: "WATCH"
};

export const LIFECYCLE = {
  NEW: "NEW",
  EMERGING: "EMERGING",
  ESTABLISHED: "ESTABLISHED"
};

// Hidden-gem star tiers (used only for ranking priority, not for classification)
export const HIDDEN_GEM_TIERS = {
  ULTRA: 1000, // < 1,000 stars  -> highest priority
  HIGH: 5000, // 1,000-5,000
  MID: 10000 // 5,000-10,000
};

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

// Has the repo actually grown (positive star delta in any tracked window)?
// Null deltas (no comparable history) count as "not growing" on purpose.
function hasPositiveGrowth(growth) {
  if (!growth) return false;
  return (growth.stars24h ?? 0) > 0 || (growth.stars7d ?? 0) > 0 || (growth.stars30d ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Signal classification (single primary label)
// Priority: BREAKOUT > HIDDEN_GEM > FAST_GROWING > WATCH
// Every non-WATCH branch REQUIRES positive growth, so it is impossible to
// raise a false alarm from a single snapshot with no growth history.
// ---------------------------------------------------------------------------
export function classifySignal(momentumScore, growth, stars) {
  const growing = hasPositiveGrowth(growth);
  const score = Number(momentumScore || 0);
  const starCount = Number(stars || 0);

  if (score >= 80 && growing) return SIGNAL.BREAKOUT;

  // Hidden Gem: low fame + meaningful momentum + actually growing.
  if (starCount < HIDDEN_GEM_TIERS.MID && score >= 55 && growing) return SIGNAL.HIDDEN_GEM;

  // Fast Growing: clear momentum, not yet a breakout, but real growth.
  if (score >= 65 && score < 80 && growing) return SIGNAL.FAST_GROWING;

  return SIGNAL.WATCH;
}

// ---------------------------------------------------------------------------
// Lifecycle classification (independent axis)
// ---------------------------------------------------------------------------
export function classifyLifecycle(ageDays) {
  if (ageDays == null) return LIFECYCLE.ESTABLISHED; // unknown age => don't claim NEW
  if (ageDays <= 30) return LIFECYCLE.NEW;
  if (ageDays <= 180) return LIFECYCLE.EMERGING;
  return LIFECYCLE.ESTABLISHED;
}

// ---------------------------------------------------------------------------
// Growth completeness: fraction of the 6 growth fields that are non-null.
// 0 when there is no history, approaches 1 as 30d windows fill in.
// ---------------------------------------------------------------------------
export function growthCompleteness(growth) {
  if (!growth) return 0;
  const fields = ["stars24h", "stars7d", "stars30d", "forks24h", "forks7d", "forks30d"];
  const present = fields.filter((f) => growth[f] != null).length;
  return clamp(present / fields.length, 0, 1);
}

// ---------------------------------------------------------------------------
// Confidence: how much we should trust this signal.
//   45% history depth (need ~7 days for a full picture)
//   35% growth completeness (are the deltas actually populated?)
//   20% momentum magnitude (high momentum is inherently more certain to act on)
// ---------------------------------------------------------------------------
export function computeConfidence({ historyDepth = 0, growthCompletenessValue = 0, momentumScore = 0 }) {
  const histFactor = clamp(Number(historyDepth || 0) / 7, 0, 1);
  const scoreFactor = clamp(Number(momentumScore || 0) / 100, 0, 1);
  const raw = 0.45 * histFactor + 0.35 * growthCompletenessValue + 0.2 * scoreFactor;
  return clamp(Math.round(raw * 100) / 100, 0, 1);
}

// ---------------------------------------------------------------------------
// Top-level: classify one repository.
// `repo` must already carry `radar` (momentumScore + growth) and raw fields.
// ---------------------------------------------------------------------------
export function classifyRepository(repo, { currentDateStr, historyDepth = 0 }) {
  const radar = repo?.radar || {};
  const momentumScore = Number(radar.momentumScore || 0);
  const growth = radar.growth || null;
  const stars = Number(repo?.stars || 0);
  const ageDays = repo?.createdAt ? daysBetween(repo.createdAt, currentDateStr) : null;

  const signalType = classifySignal(momentumScore, growth, stars);
  const lifecycleType = classifyLifecycle(ageDays);
  const gc = growthCompleteness(growth);
  const confidence = computeConfidence({ historyDepth, growthCompletenessValue: gc, momentumScore });

  return { signalType, lifecycleType, confidence, ageDays };
}

// ---------------------------------------------------------------------------
// Build the "Today's Signals" payload from a fully-enriched repo list.
// `enrichedRepos` entries are expected to carry display fields:
//   fullName, url, description, businessSummary, categoryIds, language,
//   stars, topics, momentumScore, signalType, lifecycleType, confidence,
//   ageDays, growth, radar
// Each returned array is sorted (Breakout / Fast Growing / New by momentum;
// Hidden Gems by momentum then 24h growth rate) and ranked 1..N.
// ---------------------------------------------------------------------------
export function buildSignals(enrichedRepos) {
  const all = enrichedRepos || [];
  const match = (pred) => all.filter(pred);
  const byMomentum = (arr) =>
    [...arr].sort((a, b) => Number(b.momentumScore || 0) - Number(a.momentumScore || 0));

  const breakout = byMomentum(match((r) => r.signalType === SIGNAL.BREAKOUT));
  const fastGrowing = byMomentum(match((r) => r.signalType === SIGNAL.FAST_GROWING));
  const hiddenGems = [...match((r) => r.signalType === SIGNAL.HIDDEN_GEM)].sort(
    (a, b) =>
      Number(b.momentumScore || 0) - Number(a.momentumScore || 0) ||
      Number(b.radar?.growthRate?.starGrowthRate24h ?? 0) -
        Number(a.radar?.growthRate?.starGrowthRate24h ?? 0)
  );
  const newProjects = byMomentum(match((r) => r.lifecycleType === LIFECYCLE.NEW));
  const aiRadar = byMomentum(match((r) => (r.categoryIds || []).includes("ai")));

  const assign = (arr) => arr.map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    breakout: assign(breakout),
    fastGrowing: assign(fastGrowing),
    hiddenGems: assign(hiddenGems),
    newProjects: assign(newProjects),
    aiRadar: assign(aiRadar)
  };
}

// Convenience: does a repo match a given signal-filter id used by the UI?
//   "all" | "BREAKOUT" | "FAST_GROWING" | "HIDDEN_GEM" | "NEW" | "AI"
export function matchSignalFilter(repo, signalFilter) {
  if (!signalFilter || signalFilter === "all") return true;
  if (signalFilter === "AI") return (repo.categoryIds || []).includes("ai");
  if (signalFilter === "NEW") return repo.lifecycleType === LIFECYCLE.NEW;
  return repo.signalType === signalFilter;
}
