import React from "react";
import { Github, Radar } from "lucide-react";
import { formatDate, formatNumber } from "../lib/data.js";

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="GitHub Trend Radar">
        <span className="brand-mark" aria-hidden="true">
          <Radar size={16} strokeWidth={1.75} />
        </span>
        <span className="brand-word">GitHub Trend Radar</span>
      </a>
      <nav aria-label="Site">
        <a href="#signals">Signals</a>
        <a href="#rankings">Rankings</a>
        <a href="https://github.com" target="_blank" rel="noreferrer">
          GitHub
          <Github size={13} strokeWidth={1.75} />
        </a>
      </nav>
    </header>
  );
}

export function IntroStrip({ generatedAt, totalCount }) {
  return (
    <section className="intro-strip" aria-label="About this radar">
      <div className="intro-copy">
        <h1>Discover what deserves your attention on GitHub.</h1>
        <p>
          A daily read of GitHub&apos;s momentum — which repositories are accelerating right now, and which
          quiet ones are worth a second look.
        </p>
      </div>
      <dl className="intro-meta">
        <div>
          <dt>Tracked repositories</dt>
          <dd>{formatNumber(totalCount)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{formatDate(generatedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>GitHub Trend Radar — momentum computed from public star &amp; fork history.</span>
      <a href="https://github.com" target="_blank" rel="noreferrer">
        Open GitHub
      </a>
    </footer>
  );
}
