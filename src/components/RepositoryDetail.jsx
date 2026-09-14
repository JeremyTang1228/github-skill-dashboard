import React from "react";
import { ArrowLeft, ExternalLink, Github } from "lucide-react";
import { formatNumber, formatSigned, formatDate, buildCategoryMap } from "../lib/data.js";
import { SignalBadge, MomentumScore, ComponentBar, RepoName } from "./Badges.jsx";

function GrowthBlock({ label, stars, forks }) {
  const starText = formatSigned(stars);
  const forkText = formatSigned(forks);
  return (
    <div className="detail-growth-block">
      <span className="detail-growth-label">{label}</span>
      <span className="detail-growth-value">{starText ? `${starText} ★` : "—"}</span>
      <span className="detail-growth-sub">{forkText ? `${forkText} forks` : "no fork data"}</span>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

export function RepositoryDetail({ repo, categories, period, onClose }) {
  if (!repo) {
    return (
      <aside className="repo-detail empty">
        <p>Select a repository to see momentum, growth and business context.</p>
      </aside>
    );
  }

  const categoryMap = buildCategoryMap(categories);
  const growth = repo.growth || {};
  const components = repo.components || {};
  const hasComponents = Object.values(components).some((v) => v !== null && v !== undefined);
  const hasGrowth = growth.stars24h != null || growth.stars7d != null || growth.stars30d != null;

  const ageValue = React.useMemo(() => {
    if (repo.ageDays != null) return `${repo.ageDays} days`;
    if (!repo.createdAt) return null;
    const days = Math.floor((Date.now() - new Date(repo.createdAt).getTime()) / 86400000);
    return `${Math.max(0, days)} days`;
  }, [repo.ageDays, repo.createdAt]);

  return (
    <aside className="repo-detail" aria-label="Repository detail">
      <div className="detail-top">
        {onClose ? (
          <button type="button" className="detail-back" onClick={onClose} aria-label="Back to list">
            <ArrowLeft size={16} strokeWidth={1.75} />
            <span>Back</span>
          </button>
        ) : null}
        <a className="detail-external" href={repo.url} target="_blank" rel="noreferrer" title="Open on GitHub">
          <ExternalLink size={16} strokeWidth={1.75} />
        </a>
      </div>

      <div className="detail-header">
        <SignalBadge signalType={repo.signalType} lifecycleType={repo.lifecycleType} />
        <h2>
          <RepoName fullName={repo.fullName} />
        </h2>
        <MomentumScore score={repo.momentumScore} size="lg" />
      </div>

      {!repo.descriptionZh && !repo.description && repo.businessSummary ? <p className="detail-summary">{repo.businessSummary}</p> : null}
      <p className="detail-description">{repo.descriptionZh || repo.description || "No description available."}</p>

      <section className="detail-section">
        <h3>Growth</h3>
        {hasGrowth ? (
          <div className="detail-growth-row">
            <GrowthBlock label="24h" stars={growth.stars24h} forks={growth.forks24h} />
            <GrowthBlock label="7d" stars={growth.stars7d} forks={growth.forks7d} />
            <GrowthBlock label="30d" stars={growth.stars30d} forks={growth.forks30d} />
          </div>
        ) : (
          <p className="detail-note">
            No growth history yet — deltas appear once at least two daily snapshots exist for this repo.
          </p>
        )}
      </section>

      {hasComponents ? (
        <section className="detail-section">
          <h3>Momentum breakdown</h3>
          <div className="detail-components">
            <ComponentBar label="Star Growth" value={components.starGrowth} />
            <ComponentBar label="Fork Growth" value={components.forkGrowth} />
            <ComponentBar label="Activity" value={components.activity} />
            <ComponentBar label="Freshness" value={components.freshness} />
            <ComponentBar label="Community" value={components.community} />
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h3>Repository</h3>
        <dl className="detail-facts">
          <Fact label="Stars" value={formatNumber(repo.stars)} />
          <Fact label="Forks" value={repo.forks != null ? formatNumber(repo.forks) : null} />
          <Fact label="Open issues" value={repo.openIssues != null ? formatNumber(repo.openIssues) : null} />
          <Fact label="Language" value={repo.language} />
          <Fact label="Age" value={ageValue} />
          <Fact label="Updated" value={formatDate(repo.updatedAt)} />
        </dl>
      </section>

      {repo.topics?.length ? (
        <section className="detail-section">
          <h3>Topics</h3>
          <div className="detail-tags muted">
            {repo.topics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        </section>
      ) : null}

      {repo.categoryIds?.length ? (
        <section className="detail-section">
          <h3>Category</h3>
          <div className="detail-tags">
            {repo.categoryIds.map((id) => (
              <span key={id}>{categoryMap[id] || id}</span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="detail-section detail-ai-placeholder">
        <h3>
          AI Analysis <span className="coming-soon">Available in v1.2</span>
        </h3>
        <p>Why it matters · What problem it solves · Use cases · Business opportunity · Maturity · Risks</p>
      </section>

      <a className="detail-github-link" href={repo.url} target="_blank" rel="noreferrer">
        <Github size={16} strokeWidth={1.75} />
        <span>View on GitHub</span>
      </a>
    </aside>
  );
}
