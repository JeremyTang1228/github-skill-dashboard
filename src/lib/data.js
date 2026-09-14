// ---------------------------------------------------------------------------
// Data helpers.
//
// The underlying JSON shape is intentionally treated as untrusted / partial:
// growth history, radar classification (signalType / lifecycleType) and even
// basic repo facts (forks, open issues, age) may not exist yet for a given
// snapshot. Every accessor here is written to degrade gracefully instead of
// throwing, per the "never assume a field exists" constraint.
// ---------------------------------------------------------------------------

export const SIGNAL_META = {
  BREAKOUT: { label: "Breakout", cls: "breakout" },
  FAST_GROWING: { label: "Fast Growing", cls: "fast" },
  HIDDEN_GEM: { label: "Hidden Gem", cls: "gem" },
  WATCH: { label: "Watch", cls: "watch" }
};

export const LIFECYCLE_META = {
  NEW: { label: "New", cls: "new" },
  EMERGING: { label: "Emerging", cls: "emerging" },
  ESTABLISHED: { label: "Established", cls: "established" }
};

export const SIGNAL_FILTERS = [
  { id: "all", label: "All" },
  { id: "BREAKOUT", label: "Breakout" },
  { id: "FAST_GROWING", label: "Fast Growing" },
  { id: "HIDDEN_GEM", label: "Hidden Gem" },
  { id: "NEW", label: "New" }
];

/**
 * A repo record inside rankings.<period> only carries static facts.
 * Momentum / growth / radar classification live in the separate
 * top-level `metrics[fullName]` map. This merges the two, safely.
 */
export function withMomentum(repo, metricsMap) {
  const momentum = (metricsMap && metricsMap[repo.fullName]) || {};
  return {
    ...repo,
    momentum,
    momentumScore: numOrNull(momentum.momentumScore),
    components: momentum.components || {},
    growth: momentum.growth || {},
    growthRate: momentum.growthRate || {},
    signalType: repo.signalType || momentum.signalType || null,
    lifecycleType: repo.lifecycleType || momentum.lifecycleType || null,
    confidence: numOrNull(repo.confidence ?? momentum.confidence)
  };
}

export function enrichList(list, metricsMap) {
  return (list || []).map((repo) => withMomentum(repo, metricsMap));
}

export function filterRepos(repos, categoryId, query, signalFilter) {
  const terms = buildSearchTerms(query);

  return repos.filter((repo) => {
    const categoryMatched = categoryId === "all" || (repo.categoryIds || []).includes(categoryId);
    if (!categoryMatched) return false;

    if (signalFilter && signalFilter !== "all") {
      if (signalFilter === "NEW") {
        if (repo.lifecycleType !== "NEW") return false;
      } else if (repo.signalType !== signalFilter) {
        return false;
      }
    }

    if (!terms.length) return true;

    const haystack = [
      repo.fullName,
      repo.description,
      repo.descriptionZh,
      repo.businessSummary,
      repo.language,
      ...(repo.topics || []),
      ...(repo.categoryIds || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });
}

export function buildSearchTerms(query) {
  return (query || "")
    .trim()
    .toLowerCase()
    .split(/[\s,，。；;:：/|]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function buildStats(totalRepos, filteredRepos) {
  return {
    totalCount: totalRepos.length,
    filteredCount: filteredRepos.length,
    periodStars: filteredRepos.reduce((sum, repo) => sum + Number(repo.periodStars || 0), 0)
  };
}

export function buildCategoryMap(categories) {
  return Object.fromEntries((categories || []).map((category) => [category.id, category.label]));
}

/** Counts signal groups without ever assuming the `signals` object is populated. */
export function countSignals(signals) {
  const s = signals || {};
  return {
    breakout: (s.breakout || []).length,
    fastGrowing: (s.fastGrowing || []).length,
    hiddenGems: (s.hiddenGems || []).length,
    newProjects: (s.newProjects || []).length
  };
}

export function numOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

export function formatSigned(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
  return `${sign}${formatNumber(Math.abs(n))}`;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(date);
}

export function momentumBand(score) {
  const n = numOrNull(score) ?? 0;
  if (n >= 70) return "high";
  if (n >= 40) return "mid";
  return "low";
}

// ---------------------------------------------------------------------------
// Repo facts bridge (frontend adapter only — does NOT modify the backend).
//
// The ranking records produced by scripts/generate-rankings.mjs carry momentum
// / growth / radar fields but intentionally omit the raw `forks` and
// `openIssues` counts (per the "don't reshape the backend data structure for
// the UI" rule). Those facts live in data/candidates.json, so we merge them in
// at the edge so the detail panel can show real fork / open-issue numbers.
// ---------------------------------------------------------------------------
export function buildRepoFactsMap(candidatesData) {
  const map = {};
  const repos = (candidatesData && candidatesData.repositories) || [];
  for (const repo of repos) {
    if (repo && repo.fullName) {
      map[repo.fullName] = {
        forks: repo.forks,
        openIssues: repo.openIssues,
        createdAt: repo.createdAt || null,
        descriptionZh: repo.descriptionZh || null
      };
    }
  }
  return map;
}

export function mergeRepoFacts(repo, factsMap) {
  const facts = (factsMap && factsMap[repo.fullName]) || {};
  return {
    ...repo,
    forks: repo.forks != null ? repo.forks : facts.forks != null ? facts.forks : null,
    openIssues: repo.openIssues != null ? repo.openIssues : facts.openIssues != null ? facts.openIssues : null,
    createdAt: repo.createdAt || facts.createdAt || null,
    descriptionZh: repo.descriptionZh || facts.descriptionZh || null
  };
}
