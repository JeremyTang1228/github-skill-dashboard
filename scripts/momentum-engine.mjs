// =============================================================================
// momentum-engine.mjs
// GitHub Radar — V1.1 Momentum Engine (data-calculation layer only)
//
// Pure, dependency-free functions that turn a repository's CURRENT raw state
// plus HISTORICAL snapshots into a Momentum Score and its component sub-scores.
//
// Design rules (from the V1.1 spec):
//   * Snapshots are NEVER mutated. They stay "raw state only".
//   * Missing history => null / 0, never a crash.
//   * Output is additive: it attaches `radar` to a repo, never overwrites fields.
//
// All score scales (STAR_SCALE, FORK_SCALE, etc.) are explicit, tweakable
// constants so the weighting is transparent and tunable in one place.
// =============================================================================

// --- Tunable constants -------------------------------------------------------
const STAR_SCALE = 120; // saturating scale for combined star growth magnitude
const FORK_SCALE = 20;  // forks grow ~5-10x slower than stars, so smaller scale
const ACTIVITY_HALF_LIFE_DAYS = 10;
const COMMUNITY_STAR_REF = 50000;
const COMMUNITY_FORK_REF = 10000;
const COMMUNITY_WATCHER_REF = 50000;
const COMMUNITY_ISSUE_REF = 5000;
const BOOST_FULL_RATE = 0.5; // 50%+ growth qualifies a young repo for full boost

// --- Date / numeric helpers --------------------------------------------------
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

export function daysBetween(aStr, bStr) {
  // Accept either a bare date ("2026-09-13") or a full ISO timestamp
  // ("2026-09-13T00:00:00Z"). Only append the time suffix when missing,
  // otherwise the string becomes invalid ("...Z" + "T00:00:00Z") -> NaN,
  // which previously made every repo classify as ESTABLISHED.
  const norm = (s) => (s && typeof s === "string" && s.includes("T") ? s : `${s}T00:00:00Z`);
  const a = new Date(norm(aStr)).getTime();
  const b = new Date(norm(bStr)).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// --- Snapshot index ----------------------------------------------------------
// Build a fast lookup: Map<dateString, Map<fullName, repo>>.
export function buildSnapshotIndex(snapshots) {
  const index = new Map();
  for (const snap of snapshots || []) {
    const m = new Map();
    for (const repo of snap.repositories || []) {
      if (repo && repo.fullName) m.set(repo.fullName, repo);
    }
    index.set(snap.date, m);
  }
  return index;
}

// Find the snapshot closest to targetDate. If the exact date is missing, fall
// back to the nearest available date — but only within `toleranceDays`.
// Returns the inner Map<fullName, repo> or null (so the caller treats it as
// "no comparable history").
export function lookupClosestSnapshot(index, targetDate, toleranceDays) {
  if (index.has(targetDate)) return index.get(targetDate);
  let bestKey = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const key of index.keys()) {
    const diff = Math.abs(daysBetween(key, targetDate));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }
  if (bestKey != null && bestDiff <= toleranceDays) return index.get(bestKey);
  return null;
}

// --- Growth (raw deltas) -----------------------------------------------------
// current - previous. Returns null when no comparable history exists.
export function calculateGrowth(current, previous) {
  if (!previous) return null;
  return {
    stars: (current.stars || 0) - (previous.stars || 0),
    forks: (current.forks || 0) - (previous.forks || 0),
    openIssues: (current.openIssues || 0) - (previous.openIssues || 0),
    watchers: (current.watchers || 0) - (previous.watchers || 0)
  };
}

// growth / previousValue, clamped to [0, 1]. A repo that went 0 -> N stars
// counts as a full 100% rate (it is purely new growth).
export function calculateGrowthRate(growthStars, previousStars) {
  if (previousStars == null || previousStars <= 0) {
    return growthStars > 0 ? 1 : 0;
  }
  return clamp(growthStars / previousStars, 0, 1);
}

// --- Star growth score (0-100) ----------------------------------------------
// Weighted magnitude of 24h / 7d / 30d star growth. Available windows are
// normalised so a sparse-history day still produces a meaningful score.
export function calculateStarGrowthScore(g24, g7, g30) {
  let mag = 0;
  let w = 0;
  if (g24 != null) { mag += g24 * 0.35; w += 0.35; }
  if (g7 != null) { mag += g7 * 0.4; w += 0.4; }
  if (g30 != null) { mag += g30 * 0.25; w += 0.25; }
  if (w === 0) return 0;
  const avg = mag / w;
  return 100 * (1 - Math.exp(-avg / STAR_SCALE));
}

// --- Fork growth score (0-100) ----------------------------------------------
// Forks signal real usage more than stars, so 24h is weighted higher.
export function calculateForkGrowthScore(f24, f7) {
  let mag = 0;
  let w = 0;
  if (f24 != null) { mag += f24 * 0.6; w += 0.6; }
  if (f7 != null) { mag += f7 * 0.4; w += 0.4; }
  if (w === 0) return 0;
  const avg = mag / w;
  return 100 * (1 - Math.exp(-avg / FORK_SCALE));
}

// --- Activity score (0-100) -------------------------------------------------
// Driven by recency of `pushedAt` with a small open-issues engagement factor.
// No extra API calls — uses fields already collected.
export function calculateActivityScore(repo, nowMs) {
  const pushedAt = repo.pushedAt ? new Date(repo.pushedAt).getTime() : NaN;
  const daysSincePush = Number.isFinite(pushedAt) ? (nowMs - pushedAt) / 86400000 : Number.POSITIVE_INFINITY;
  const recency = Number.isFinite(daysSincePush)
    ? clamp(100 * Math.exp(-daysSincePush / ACTIVITY_HALF_LIFE_DAYS), 0, 100)
    : 0;
  const issueEngagement = clamp(repo.openIssues || 0, 0, 100);
  return clamp(0.85 * recency + 0.15 * issueEngagement, 0, 100);
}

// --- Freshness score (0-100) -------------------------------------------------
// Pure function of project age from `createdAt`.
export function calculateFreshnessScore(createdAt, nowMs) {
  if (!createdAt) return 20;
  const ageDays = (nowMs - new Date(createdAt).getTime()) / 86400000;
  if (ageDays <= 7) return 100;
  if (ageDays <= 30) return 90;
  if (ageDays <= 90) return 70;
  if (ageDays <= 180) return 45;
  return 20;
}

// --- Community score (0-100) -------------------------------------------------
// Log-normalised blend of stars / forks / watchers / open issues. Deliberately
// NOT just stars, so a high-star but low-engagement repo is not over-rated.
export function calculateCommunityScore(repo) {
  const stars = repo.stars || 0;
  const forks = repo.forks || 0;
  const watchers = repo.watchers || 0;
  const issues = repo.openIssues || 0;
  const starScore = clamp((100 * Math.log10(1 + stars)) / Math.log10(1 + COMMUNITY_STAR_REF), 0, 100);
  const forkScore = clamp((100 * Math.log10(1 + forks)) / Math.log10(1 + COMMUNITY_FORK_REF), 0, 100);
  const watcherScore = clamp((100 * Math.log10(1 + watchers)) / Math.log10(1 + COMMUNITY_WATCHER_REF), 0, 100);
  const issueScore = clamp((100 * Math.log10(1 + issues)) / Math.log10(1 + COMMUNITY_ISSUE_REF), 0, 100);
  return clamp(0.4 * starScore + 0.3 * forkScore + 0.2 * watcherScore + 0.1 * issueScore, 0, 100);
}

// --- Early momentum boost (0-15) --------------------------------------------
// Keeps big, established repos from permanently dominating: young (<90d) and
// still-small (<10000 stars) repos that are growing fast get an extra nudge.
export function calculateEarlyMomentumBoost(ageDays, stars, peakRate) {
  if (ageDays == null || ageDays >= 90) return 0;
  if ((stars || 0) >= 10000) return 0;
  const rate = clamp(peakRate || 0, 0, 1);
  return clamp(15 * (rate / BOOST_FULL_RATE), 0, 15);
}

// --- Momentum score (0-100) -------------------------------------------------
//   Star Growth 40% | Fork Growth 20% | Activity 15% | Freshness 15% | Community 10%
export function calculateMomentumScore(components, earlyBoost) {
  const base =
    (components.starGrowth || 0) * 0.4 +
    (components.forkGrowth || 0) * 0.2 +
    (components.activity || 0) * 0.15 +
    (components.freshness || 0) * 0.15 +
    (components.community || 0) * 0.1;
  return clamp(base + (earlyBoost || 0), 0, 100);
}

// --- Top-level: compute the full `radar` object for one repo -----------------
// Inputs:
//   repo            : current raw repo (id, fullName, stars, forks, openIssues,
//                     watchers, createdAt, pushedAt, updatedAt, ...)
//   snapshotIndex   : Map<date, Map<fullName, repo>> built from historical snapshots
//   currentDateStr  : today's date string (YYYY-MM-DD)
export function computeRadarMetrics(repo, snapshotIndex, currentDateStr) {
  const nowMs = new Date(`${currentDateStr}T00:00:00Z`).getTime();

  const prev24 = lookupClosestSnapshot(snapshotIndex, addDays(currentDateStr, -1), 2)?.get(repo.fullName) || null;
  const prev7 = lookupClosestSnapshot(snapshotIndex, addDays(currentDateStr, -7), 4)?.get(repo.fullName) || null;
  const prev30 = lookupClosestSnapshot(snapshotIndex, addDays(currentDateStr, -30), 7)?.get(repo.fullName) || null;

  const g24 = calculateGrowth(repo, prev24);
  const g7 = calculateGrowth(repo, prev7);
  const g30 = calculateGrowth(repo, prev30);

  const r24 = g24 ? calculateGrowthRate(g24.stars, prev24.stars) : null;
  const r7 = g7 ? calculateGrowthRate(g7.stars, prev7.stars) : null;
  const r30 = g30 ? calculateGrowthRate(g30.stars, prev30.stars) : null;

  const starGrowthScore = calculateStarGrowthScore(g24?.stars, g7?.stars, g30?.stars);
  const forkGrowthScore = calculateForkGrowthScore(g24?.forks, g7?.forks);
  const activityScore = calculateActivityScore(repo, nowMs);
  const freshnessScore = calculateFreshnessScore(repo.createdAt, nowMs);
  const communityScore = calculateCommunityScore(repo);

  const components = {
    starGrowth: round1(starGrowthScore),
    forkGrowth: round1(forkGrowthScore),
    activity: round1(activityScore),
    freshness: round1(freshnessScore),
    community: round1(communityScore)
  };

  const ageDays = repo.createdAt ? daysBetween(repo.createdAt, currentDateStr) : null;
  const peakRate = [r24, r7, r30].reduce((m, v) => (v == null ? m : Math.max(m, v)), 0);
  const earlyBoost = calculateEarlyMomentumBoost(ageDays, repo.stars, peakRate);

  const momentumScore = calculateMomentumScore(components, earlyBoost);

  return {
    momentumScore: round1(momentumScore),
    components,
    earlyMomentumBoost: round1(earlyBoost),
    growth: {
      stars24h: g24?.stars ?? null,
      stars7d: g7?.stars ?? null,
      stars30d: g30?.stars ?? null,
      forks24h: g24?.forks ?? null,
      forks7d: g7?.forks ?? null,
      forks30d: g30?.forks ?? null
    },
    growthRate: {
      starGrowthRate24h: r24 != null ? round3(r24) : null,
      starGrowthRate7d: r7 != null ? round3(r7) : null,
      starGrowthRate30d: r30 != null ? round3(r30) : null
    }
  };
}
