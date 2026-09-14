import React from "react";
import { formatNumber, formatSigned, buildCategoryMap } from "../lib/data.js";
// growthRate values are stored as fractions (e.g. 1.86 == +186%); only ever
// rendered when the backend actually supplies a number, never estimated.
import { SignalBadge, MomentumScore, RepoName } from "./Badges.jsx";

function GrowthPair({ label, value }) {
  const text = formatSigned(value);
  return (
    <span className="growth-pair">
      <span className="growth-pair-label">{label}</span>
      <span className={`growth-pair-value${text ? "" : " empty"}`}>{text || "—"}</span>
    </span>
  );
}

function scrollRepoIntoView(element) {
  const rect = element.getBoundingClientRect();
  const headerOffset = 88;
  if (rect.top <= headerOffset) return;
  const top = rect.top + window.scrollY - headerOffset;
  window.scrollTo({ top, behavior: "smooth" });
}

export function RepositoryCard({ repo, categories, selected, onSelect }) {
  const categoryMap = buildCategoryMap(categories);
  const tags = (repo.categoryIds || []).slice(0, 3).map((id) => categoryMap[id] || id);

  return (
    <button
      type="button"
      className={selected ? "repo-card selected" : "repo-card"}
      onClick={(event) => {
        scrollRepoIntoView(event.currentTarget);
        document.querySelector(".repo-detail")?.scrollTo({ top: 0, behavior: "auto" });
        onSelect();
      }}
    >
      <div className="repo-card-top">
        <SignalBadge signalType={repo.signalType} lifecycleType={repo.lifecycleType} />
        <span className="repo-card-lang">{repo.language || "—"}</span>
      </div>

      <span className="repo-card-name">
        <RepoName fullName={repo.fullName} />
      </span>

      <div className="repo-card-momentum">
        <MomentumScore score={repo.momentumScore} size="sm" />
        <div className="repo-card-growth">
          <GrowthPair label="24h" value={repo.growth?.stars24h} />
          <GrowthPair label="7d" value={repo.growth?.stars7d} />
          {repo.growthRate?.starGrowthRate7d != null ? (
            <span className="growth-rate">
              {formatSigned(repo.growthRate.starGrowthRate7d * 100)}% vs prev 7d
            </span>
          ) : null}
        </div>
      </div>

      <p className="repo-card-desc">{repo.descriptionZh || repo.description || repo.businessSummary || "No summary yet."}</p>

      {tags.length ? (
        <div className="repo-card-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

function periodScoreFor(repo, periodId) {
  if (periodId === "daily") return repo.periodStars ?? repo.growth?.stars24h;
  if (periodId === "weekly") return repo.periodStars ?? repo.growth?.stars7d;
  if (periodId === "monthly") return repo.periodStars ?? repo.growth?.stars30d;
  if (periodId === "all") return repo.stars;
  return repo.periodStars ?? repo.momentumScore;
}

function periodScoreLabel(periodId) {
  if (periodId === "daily") return "24h";
  if (periodId === "weekly") return "7d";
  if (periodId === "monthly") return "30d";
  if (periodId === "all") return "stars";
  return "period";
}

export function RepositoryRow({ repo, selected, onSelect, periodId }) {
  const score = periodScoreFor(repo, periodId);
  return (
    <button
      type="button"
      className={selected ? "repo-row selected" : "repo-row"}
      onClick={(event) => {
        scrollRepoIntoView(event.currentTarget);
        document.querySelector(".repo-detail")?.scrollTo({ top: 0, behavior: "auto" });
        onSelect();
      }}
    >
      <span className="repo-row-rank">{String(repo.rank ?? "—").padStart(2, "0")}</span>
      <span className="repo-row-score" title={`${periodScoreLabel(periodId)} score`}>{formatNumber(score)}</span>
      <span className="repo-row-name">
        <RepoName fullName={repo.fullName} />
        <SignalBadge signalType={repo.signalType} lifecycleType={repo.lifecycleType} compact />
      </span>
      <span className="repo-row-lang">{repo.language || "—"}</span>
      <span className="repo-row-stars">★ {formatNumber(repo.stars)}</span>
      <span className="repo-row-period">{formatSigned(repo.periodStars) || "—"}</span>
    </button>
  );
}

export function RepositoryList({ repos, categories, view, selectedName, onSelect, periodId = "daily" }) {
  if (!repos.length) {
    return <div className="empty-state">No repositories match these filters. Try another category or signal.</div>;
  }

  if (view === "list") {
    return (
      <div className="repo-list repo-list-compact" role="list">
        <div className="repo-row repo-row-head" aria-hidden="true">
          <span className="repo-row-rank">#</span>
          <span className="repo-row-score">{periodScoreLabel(periodId)}</span>
          <span className="repo-row-name">Repository</span>
          <span className="repo-row-lang">Language</span>
          <span className="repo-row-stars">Stars</span>
          <span className="repo-row-period">Period</span>
        </div>
        {repos.map((repo) => (
          <RepositoryRow
            key={repo.fullName}
            repo={repo}
            periodId={periodId}
            selected={repo.fullName === selectedName}
            onSelect={() => onSelect(repo.fullName)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="repo-list repo-list-cards" role="list">
      {repos.map((repo) => (
        <RepositoryCard
          key={repo.fullName}
          repo={repo}
          categories={categories}
          selected={repo.fullName === selectedName}
          onSelect={() => onSelect(repo.fullName)}
        />
      ))}
    </div>
  );
}
