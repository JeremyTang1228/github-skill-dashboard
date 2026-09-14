import React from "react";
import rankingsData from "../data/rankings.json";
import candidatesData from "../data/candidates.json";
import { SiteHeader, IntroStrip, SiteFooter } from "./components/Layout.jsx";
import { TodaysSignals } from "./components/TodaysSignals.jsx";
import { TrendBoard } from "./components/TrendBoard.jsx";
import {
  enrichList,
  filterRepos,
  buildStats,
  countSignals,
  buildRepoFactsMap,
  mergeRepoFacts
} from "./lib/data.js";

const MOBILE_QUERY = "(max-width: 860px)";

export default function App() {
  const [periodId, setPeriodId] = React.useState("daily");
  const [categoryId, setCategoryId] = React.useState("all");
  const [signalFilter, setSignalFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [selectedRepoName, setSelectedRepoName] = React.useState("");
  const [view, setView] = React.useState("card");
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);

  const periods = rankingsData.periods || [];
  const categories = rankingsData.categories || [];
  const metrics = rankingsData.metrics || {};
  const signals = rankingsData.signals || null;
  const stats = rankingsData.stats || {};

  // Bridge: raw forks / open-issues live in candidates.json (ranking records omit them).
  const factsMap = React.useMemo(() => buildRepoFactsMap(candidatesData), [candidatesData]);

  // Claude UI's Header / Today's Signals read `stats.totalRepositories`; the backend
  // emits `stats.candidateCount`. Adapt at the edge instead of reshaping the backend.
  const signalStats = React.useMemo(
    () => ({ ...stats, totalRepositories: stats.candidateCount ?? stats.totalRepositories ?? 0 }),
    [stats]
  );

  React.useEffect(() => {
    if (!periods.length) return;
    if (!periods.some((period) => period.id === periodId)) {
      setPeriodId(periods[0].id);
    }
  }, [periods, periodId]);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    if (mql.matches) setView("list");
  }, []);

  const activePeriod = periods.find((period) => period.id === periodId) || periods[0];
  const activeCategory = categories.find((category) => category.id === categoryId) || categories[0];

  // Full tracked pool (every candidate, all display fields present). The
  // per-period boards are capped at 100 by the generator, which would hide most
  // repos that match a lifecycle/category signal (e.g. only 0 of the top-100
  // daily repos are NEW). We use this pool so signal filters and the total
  // board resolve across all 1997 tracked repos.
  const fullPool = React.useMemo(
    () =>
      enrichList(
        (candidatesData?.repositories || []).map((c) => ({
          ...c,
          categoryIds:
            c.discovery?.categories && c.discovery.categories.length
              ? c.discovery.categories
              : ["developer"]
        })),
        metrics
      ).map((repo) => mergeRepoFacts(repo, factsMap)),
    [metrics, factsMap]
  );

  const activeRepos = React.useMemo(
    () =>
      enrichList(rankingsData.rankings?.[activePeriod?.id], metrics).map((repo) =>
        mergeRepoFacts(repo, factsMap)
      ),
    [activePeriod?.id, metrics, factsMap]
  );

  // Fall back to the full pool whenever a signal filter is active (so New / AI /
  // Breakout resolve across all repos) or when the total board is selected.
  const baseRepos = signalFilter !== "all" || periodId === "all" ? fullPool : activeRepos;

  const filteredRepos = React.useMemo(
    () => filterRepos(baseRepos, categoryId, query, signalFilter),
    [baseRepos, categoryId, query, signalFilter]
  );

  const selectedRepo = React.useMemo(() => {
    if (!filteredRepos.length) return null;
    return filteredRepos.find((repo) => repo.fullName === selectedRepoName) || filteredRepos[0];
  }, [filteredRepos, selectedRepoName]);

  React.useEffect(() => {
    if (!filteredRepos.length) {
      setSelectedRepoName("");
      return;
    }
    if (!filteredRepos.some((repo) => repo.fullName === selectedRepoName)) {
      setSelectedRepoName(filteredRepos[0].fullName);
    }
  }, [periodId, categoryId, signalFilter, query, filteredRepos, selectedRepoName]);

  const boardStats = React.useMemo(() => buildStats(baseRepos, filteredRepos), [baseRepos, filteredRepos]);
  const signalCounts = React.useMemo(() => countSignals(signals), [signals]);

  const focusRankings = () => {
    document.getElementById("rankings")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pickSignalFilter = (filterId, fullName) => {
    setPeriodId("all");
    setCategoryId("all");
    setQuery("");
    setSignalFilter(filterId);
    if (fullName) setSelectedRepoName(fullName);
    focusRankings();
  };

  const handleSignalChange = (filterId) => {
    if (filterId !== "all" && signalFilter === "all") {
      setPeriodId("all");
    }
    setSignalFilter(filterId);
  };

  const selectRepo = (fullName) => {
    setSelectedRepoName(fullName);
    if (window.matchMedia(MOBILE_QUERY).matches) setMobileDetailOpen(true);
  };

  return (
    <div className="site-shell" id="top">
      <SiteHeader />
      <main>
        <IntroStrip generatedAt={rankingsData.generatedAt} totalCount={signalStats.totalRepositories} />

        <TodaysSignals
          counts={signalCounts}
          stats={signalStats}
          onPickFilter={pickSignalFilter}
        />

        <TrendBoard
          periods={periods}
          categories={categories}
          periodId={periodId}
          categoryId={categoryId}
          signalFilter={signalFilter}
          query={query}
          view={view}
          repos={filteredRepos}
          selectedRepo={selectedRepo}
          stats={boardStats}
          activePeriod={activePeriod}
          activeCategory={activeCategory}
          mobileDetailOpen={mobileDetailOpen}
          onPeriodChange={setPeriodId}
          onCategoryChange={setCategoryId}
          onSignalChange={handleSignalChange}
          onQueryChange={setQuery}
          onViewChange={setView}
          onSelectRepo={selectRepo}
          onCloseMobileDetail={() => setMobileDetailOpen(false)}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
