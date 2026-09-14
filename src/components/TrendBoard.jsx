import React from "react";
import { Search, LayoutGrid, List as ListIcon, Flame, Github, Trophy } from "lucide-react";
import { SIGNAL_FILTERS, formatSigned, formatNumber } from "../lib/data.js";
import { RepositoryList } from "./RepositoryList.jsx";
import { RepositoryDetail } from "./RepositoryDetail.jsx";

export function TrendBoard({
  periods,
  categories,
  periodId,
  categoryId,
  signalFilter,
  query,
  view,
  repos,
  selectedRepo,
  stats,
  activePeriod,
  activeCategory,
  mobileDetailOpen,
  onPeriodChange,
  onCategoryChange,
  onSignalChange,
  onQueryChange,
  onViewChange,
  onSelectRepo,
  onCloseMobileDetail
}) {
  return (
    <section className="trend-board" id="rankings" aria-label="Trend board">
      <div className="section-heading with-metrics">
        <div>
          <span className="eyebrow">Trend Board</span>
          <h2>
            {activePeriod?.label || "Rankings"} · {activeCategory?.label || "All"}
          </h2>
          <p>
            {activePeriod?.description}
            {activeCategory?.description ? ` — ${activeCategory.description}` : ""}
          </p>
        </div>
        <div className="metric-strip">
          <span className="metric" title="Stars gained in the selected period">
            <span className="metric-value">
              <Flame size={14} strokeWidth={1.75} />
              {formatSigned(stats.periodStars) || "+0"}
            </span>
            <span className="metric-label">period stars</span>
          </span>
          <span className="metric" title="Repositories matching current filters">
            <span className="metric-value">
              <Github size={14} strokeWidth={1.75} />
              {stats.filteredCount}
            </span>
            <span className="metric-label">shown</span>
          </span>
          <span className="metric" title="Total repositories tracked by the radar">
            <span className="metric-value">
              <Trophy size={14} strokeWidth={1.75} />
              {formatNumber(stats.totalCount)}
            </span>
            <span className="metric-label">tracked</span>
          </span>
        </div>
      </div>

      <div className="toolbar-row">
        <div className="period-tabs" role="tablist" aria-label="Ranking period">
          {periods.map((period) => (
            <button
              key={period.id}
              role="tab"
              type="button"
              aria-selected={period.id === periodId}
              className={period.id === periodId ? "period-tab active" : "period-tab"}
              onClick={() => onPeriodChange(period.id)}
            >
              {period.label}
            </button>
          ))}
        </div>

        <label className="search-control">
          <Search size={15} strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索仓库、话题或语言"
          />
        </label>

        <div className="view-toggle" role="group" aria-label="List view">
          <button
            type="button"
            aria-pressed={view === "card"}
            className={view === "card" ? "view-btn active" : "view-btn"}
            onClick={() => onViewChange("card")}
            title="Card view"
          >
            <LayoutGrid size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            className={view === "list" ? "view-btn active" : "view-btn"}
            onClick={() => onViewChange("list")}
            title="Compact list"
          >
            <ListIcon size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="filter-row category-row" aria-label="Category">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={category.id === categoryId ? "category-chip active" : "category-chip"}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>

      <div className="filter-row signal-row" aria-label="Signal">
        {SIGNAL_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === signalFilter ? "signal-chip active" : "signal-chip"}
            onClick={() => onSignalChange(option.id)}
          >
            <span className={`signal-dot ${option.id.toLowerCase()}`} aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>

      <div className="board-layout">
        <RepositoryList
          repos={repos}
          categories={categories}
          view={view}
          selectedName={selectedRepo?.fullName}
          onSelect={onSelectRepo}
          periodId={periodId}
        />

        <div className={mobileDetailOpen ? "detail-slot mobile-open" : "detail-slot"}>
          <RepositoryDetail
            repo={selectedRepo}
            categories={categories}
            period={activePeriod}
            onClose={onCloseMobileDetail}
          />
        </div>
      </div>
    </section>
  );
}
