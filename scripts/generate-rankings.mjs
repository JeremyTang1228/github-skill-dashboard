import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRadarMetrics, buildSnapshotIndex } from "./momentum-engine.mjs";
import { classifyRepository, buildSignals } from "./radar-classifier.mjs";
import { translateDescriptions } from "./lib/translation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const snapshotDir = path.join(dataDir, "snapshots");
const outputPath = path.join(dataDir, "rankings.json");
const candidatesPath = path.join(dataDir, "candidates.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// --- Runtime tuning (env-overridable, safe defaults for unauthenticated GitHub API) ---
const hasToken = Boolean(process.env.GITHUB_TOKEN);
const capArg = Number(process.env.RADAR_QUERY_CAP || 0);
const queryCap = Number.isFinite(capArg) && capArg > 0 ? capArg : Infinity;
const requestDelayMs = Number(process.env.RADAR_REQUEST_DELAY_MS || (hasToken ? 2000 : 6500));
const perPage = Math.min(100, Math.max(10, Number(process.env.RADAR_PER_PAGE || 100)));

const today = new Date();
const todayStr = today.toISOString().slice(0, 10);

// Date windows for the ACTIVE / NEW discovery modes (dynamic, so the script stays evergreen).
const activeSince = shiftDays(today, -60).toISOString().slice(0, 10);
const newSince = shiftDays(today, -45).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Static metadata (kept identical so the existing React dashboard keeps working)
// ---------------------------------------------------------------------------
const categories = [
  { id: "all", label: "全部", description: "所有业务技术趋势" },
  { id: "ai", label: "AI", description: "模型、Agent、RAG、多模态、AI 应用与 LLMOps" },
  { id: "social", label: "社媒", description: "抖音、小红书、Twitter/X、B站、YouTube 等平台工具" },
  { id: "local-life", label: "本地生活", description: "外卖、餐饮、到店、家政、履约、酒旅等业务工具" },
  { id: "developer", label: "程序员", description: "开发框架、工程效率、测试、DevOps 与代码工具" },
  { id: "marketing", label: "营销市场", description: "增长、投放、CRM、SEO、活动和用户分析" },
  { id: "pr", label: "公关传播", description: "舆情、媒体监测、传播分析、品牌声誉与危机响应" },
  { id: "legal", label: "法务合规", description: "合同、隐私、安全合规、审计、政策和风险管理" },
  { id: "finance", label: "财务金融", description: "财务、会计、支付、投资、风控和金融数据分析" },
  { id: "design", label: "设计创意", description: "UI、视觉、图片、视频、3D、动效和创意生产" },
  { id: "ops", label: "运营管理", description: "流程自动化、项目管理、客服、监控、知识库和内部工具" }
];

const periods = [
  { id: "daily", label: "日榜", description: "过去 24 小时新增热度" },
  { id: "weekly", label: "周榜", description: "最近 7 天 Star 增长与趋势动能" },
  { id: "monthly", label: "月榜", description: "最近 30 天持续升温" },
  { id: "all", label: "总榜", description: "长期值得收藏的基础项目（主要反映 Star 规模）" }
];

// ---------------------------------------------------------------------------
// Discovery strategy
// Three modes per business category, built from GitHub Search query filters.
//   POPULAR : high community scale (stars thresholds)
//   ACTIVE  : still under active development (pushed:>DATE)
//   NEW     : freshly created (created:>DATE)
// ---------------------------------------------------------------------------
const categoryKeywordGroups = {
  ai: ["llm rag agent", "generative-ai multimodal", "llmops evaluation observability"],
  social: ["topic:social-media", "tiktok youtube twitter analytics", "wechat instagram reddit content"],
  "local-life": [
    "food delivery restaurant ordering",
    "restaurant pos reservation menu",
    "hotel booking travel tourism",
    "logistics dispatch route optimization",
    "home services booking marketplace"
  ],
  developer: ["developer-tools cli framework", "testing devops ci cd", "code-review static-analysis"],
  marketing: ["marketing analytics crm", "seo growth analytics", "campaign attribution dashboard"],
  pr: ["sentiment-analysis media-monitoring", "news monitoring reputation", "osint public opinion"],
  legal: ["legal contract analysis", "privacy compliance gdpr", "policy audit security compliance"],
  finance: ["finance accounting dashboard", "payment billing invoice", "risk trading portfolio analysis"],
  design: ["design system ui components", "image video generation creative", "figma animation 3d"],
  ops: ["workflow automation internal tool", "customer support knowledge base", "project management monitoring alerts"]
};

function buildSearchPlans() {
  const plans = [];
  for (const [category, groups] of Object.entries(categoryKeywordGroups)) {
    for (const keywords of groups) {
      plans.push({
        category,
        mode: "popular",
        query: `${keywords} stars:>100 fork:false archived:false`
      });
      plans.push({
        category,
        mode: "active",
        query: `${keywords} stars:>20 pushed:>${activeSince} fork:false archived:false`
      });
      plans.push({
        category,
        mode: "new",
        query: `${keywords} created:>${newSince} fork:false archived:false`
      });
    }
  }
  return plans;
}

await main();

async function main() {
  logBannerStart();

  let { candidates, rawCount, filteredCount, failedPlans, planCount } = await collectCandidates();

  // Translation step. Set TRANSLATION_PROVIDER + TRANSLATION_API_KEY to translate
  // new English descriptions. When no provider is configured, we still re-apply any
  // cached translations from data/translations.json so previously translated Chinese
  // descriptions survive a plain re-run.
  const translated = await translateDescriptions({ repositories: candidates });
  candidates = translated.repositories;

  if (!candidates.length) {
    // Critical failure path: do NOT overwrite history. Keep old files, fail the run.
    throw new Error("未采集到任何候选仓库（所有查询失败）。保留旧数据，结束本次运行。");
  }

  const previousSnapshots = await readAllSnapshots();
  const snapshotIndex = buildSnapshotIndex(previousSnapshots);

  // How many historical daily snapshots contain each repo (drives confidence).
  const historyCount = new Map();
  for (const snap of previousSnapshots) {
    for (const repo of snap.repositories || []) {
      if (repo && repo.fullName) historyCount.set(repo.fullName, (historyCount.get(repo.fullName) || 0) + 1);
    }
  }

  // --- Momentum Engine + Radar Classifier: compute, classify, attach ---
  // Each repository owns its `radar` object (growth, components, momentumScore,
  // signalType, lifecycleType, confidence). Original raw fields are never overwritten.
  const metrics = {};
  const histStats = { day1: 0, day7: 0, day30: 0 };
  for (const c of candidates) {
    const radar = computeRadarMetrics(c, snapshotIndex, todayStr);
    const { signalType, lifecycleType, confidence, ageDays } = classifyRepository(c, {
      currentDateStr: todayStr,
      historyDepth: historyCount.get(c.fullName) || 0
    });
    radar.signalType = signalType;
    radar.lifecycleType = lifecycleType;
    radar.confidence = confidence;
    c.radar = radar;
    c.ageDays = ageDays;
    metrics[c.fullName] = radar;
    if (radar.growth.stars24h != null) histStats.day1 += 1;
    if (radar.growth.stars7d != null) histStats.day7 += 1;
    if (radar.growth.stars30d != null) histStats.day30 += 1;
  }

  // Momentum ranking = all candidates sorted by score (desc). Kept separate from
  // the star-based daily / weekly / monthly / all lists so the legacy dashboard is untouched.
  const momentumRanking = [...candidates]
    .sort((a, b) => b.radar.momentumScore - a.radar.momentumScore)
    .map((c, i) => ({
      rank: i + 1,
      fullName: c.fullName,
      description: c.description,
      descriptionZh: c.descriptionZh || null,
      momentumScore: c.radar.momentumScore,
      signalType: c.radar.signalType,
      lifecycleType: c.radar.lifecycleType,
      confidence: c.radar.confidence
    }));

  // Snapshot = pure raw state only (field whitelist, never carries radar).
  // Candidates.json is the internal data layer and DOES carry radar (harmless, useful).
  if (!dryRun) {
    await fs.mkdir(snapshotDir, { recursive: true });
    await saveSnapshot(todayStr, candidates);
    await saveCandidates(candidates);
  }

  // Ranking records: legacy dashboard keeps working, now enriched with radar fields.
  const records = candidates.map((c) => {
    const enriched = attachDeltas(c, previousSnapshots);
    const categoryIds = inferCategories(c);
    const weeklyGrowth = c.radar.growth.stars7d ?? 0;
    return {
      rank: 0,
      fullName: c.fullName,
      url: c.url,
      description: c.description,
      descriptionZh: c.descriptionZh,
      businessSummary: (c.description || "").trim() ? "" : summarizeBusinessValue({ ...c, categoryIds }),
      categoryIds,
      language: c.language,
      stars: c.stars,
      periodStars: 0,
      updatedAt: (c.updatedAt || "").slice(0, 10),
      topics: c.topics,
      momentumScore: c.radar.momentumScore,
      signalType: c.radar.signalType,
      lifecycleType: c.radar.lifecycleType,
      confidence: c.radar.confidence,
      ageDays: c.ageDays,
      growth: c.radar.growth,
      radar: c.radar,
      dailyDelta: enriched.dailyDelta,
      monthlyDelta: enriched.monthlyDelta,
      allScore: enriched.allScore,
      weeklyScore: weeklyGrowth + c.radar.momentumScore,
      weeklyGrowth
    };
  });

  const rankings = {
    daily: rankRepos(records, { scoreKey: "dailyDelta", limit: 100 }),
    weekly: rankRepos(records, { scoreKey: "weeklyScore", periodStarsKey: "weeklyGrowth", limit: 100 }),
    monthly: rankRepos(records, { scoreKey: "monthlyDelta", limit: 100 }),
    all: rankRepos(records, { scoreKey: "allScore", periodStarsKey: "stars", limit: Infinity }),
    momentumRanking
  };

  // Enriched list for the signals payload (display fields + radar).
  const enriched = candidates.map((c) => {
    const categoryIds = inferCategories(c);
    return {
      fullName: c.fullName,
      url: c.url,
      description: c.description,
      descriptionZh: c.descriptionZh,
      businessSummary: (c.description || "").trim() ? "" : summarizeBusinessValue({ ...c, categoryIds }),
      categoryIds,
      language: c.language,
      stars: c.stars,
      topics: c.topics,
      momentumScore: c.radar.momentumScore,
      signalType: c.radar.signalType,
      lifecycleType: c.radar.lifecycleType,
      confidence: c.radar.confidence,
      ageDays: c.ageDays,
      growth: c.radar.growth,
      radar: c.radar,
      periodStars: c.radar.growth.stars24h ?? 0
    };
  });
  const signals = buildSignals(enriched);

  const averageMomentum =
    candidates.reduce((sum, c) => sum + c.radar.momentumScore, 0) / (candidates.length || 1);

  const signalCount = new Set([
    ...signals.breakout,
    ...signals.fastGrowing,
    ...signals.hiddenGems,
    ...signals.newProjects
  ].map((r) => r.fullName)).size;

  const stats = {
    candidateCount: candidates.length,
    qualifiedCount: candidates.length,
    signalCount,
    signalBreakdown: {
      breakout: signals.breakout.length,
      fastGrowing: signals.fastGrowing.length,
      hiddenGems: signals.hiddenGems.length,
      newProjects: signals.newProjects.length,
      aiRadar: signals.aiRadar.length
    },
    historicalAvailability: histStats,
    averageMomentumScore: round1(averageMomentum),
    topMomentum: momentumRanking.slice(0, 10)
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    periods,
    categories,
    rankings,
    signals,
    metrics,
    stats,
    meta: {
      candidateCount: candidates.length,
      searchPlans: planCount,
      failedPlans,
      rawResults: rawCount,
      filteredResults: filteredCount,
      snapshotDate: todayStr
    }
  };

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  logBannerEnd({ planCount, rawCount, filteredCount, deduped: candidates.length, failedPlans });
  logMomentumBanner({ total: candidates.length, histStats, momentumRanking, signals, stats });
  console.log(`已生成榜单：${outputPath}`);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
async function collectCandidates() {
  const plans = buildSearchPlans().slice(0, queryCap);
  const collected = [];
  let rawCount = 0;
  let filteredCount = 0;
  let failedPlans = 0;

  for (const plan of plans) {
    try {
      const items = await searchRepositories(plan.query);
      rawCount += items.length;
      for (const repo of items) {
        if (!isUsefulCandidate(repo)) continue;
        filteredCount += 1;
        collected.push(normalizeRepository(repo, plan.mode, plan.category));
      }
    } catch (err) {
      failedPlans += 1;
      console.warn(`⚠ 查询失败已跳过（保留其余数据）：${plan.query.slice(0, 64)} -> ${err.message}`);
    }
    await sleep(requestDelayMs);
  }

  const candidates = deduplicateRepositories(collected);
  return { candidates, rawCount, filteredCount, failedPlans, planCount: plans.length };
}

async function searchRepositories(query, attempt = 0) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  // Note: GitHub Search does NOT support sort=created; we use created:>DATE as a filter
  // and rely on the API-supported sort=stars ordering.
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(perPage));

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-radar-collector"
  };
  if (hasToken) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const remaining = response.headers.get("x-ratelimit-remaining");
    const resetAt = Number(response.headers.get("x-ratelimit-reset") || 0) * 1000;
    if (response.status === 403 && remaining === "0" && resetAt && attempt < 2) {
      const waitMs = Math.max(2000, resetAt - Date.now() + 2000);
      console.warn(`⚠ GitHub 搜索限流，${Math.ceil(waitMs / 1000)} 秒后重试：${query.slice(0, 64)}`);
      await sleep(waitMs);
      return searchRepositories(query, attempt + 1);
    }
    throw new Error(`GitHub 搜索失败：${response.status} ${response.statusText} ${body.slice(0, 240)}`);
  }

  const payload = await response.json();
  return payload.items || [];
}

// ---------------------------------------------------------------------------
// Repository normalize layer
// Converts GitHub Search API repo objects into GitHub Radar's internal format.
// Pure, observed fields only — no computed deltas / scores.
// ---------------------------------------------------------------------------
function normalizeRepository(repo, mode, categoryId) {
  return {
    id: Number(repo.id),
    fullName: repo.full_name,
    url: repo.html_url,
    description: cleanDescription(repo.description),
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || 0),
    openIssues: Number(repo.open_issues_count || 0),
    watchers: Number(repo.subscribers_count || repo.watchers_count || 0),
    language: repo.language || "Unknown",
    topics: repo.topics || [],
    createdAt: repo.created_at || "",
    updatedAt: repo.updated_at || "",
    pushedAt: repo.pushed_at || "",
    isFork: Boolean(repo.fork),
    isArchived: Boolean(repo.archived),
    discovery: {
      modes: [mode],
      categories: [categoryId]
    }
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// Keyed by full_name. Merges discovery modes + categories; never overwrites.
// ---------------------------------------------------------------------------
function deduplicateRepositories(repos) {
  const map = new Map();
  for (const repo of repos) {
    const existing = map.get(repo.fullName);
    if (!existing) {
      map.set(repo.fullName, structuredClone(repo));
      continue;
    }
    existing.discovery.modes = unique([...existing.discovery.modes, ...repo.discovery.modes]);
    existing.discovery.categories = unique([...existing.discovery.categories, ...repo.discovery.categories]);
    existing.stars = Math.max(existing.stars || 0, repo.stars || 0);
    existing.forks = Math.max(existing.forks || 0, repo.forks || 0);
    existing.openIssues = Math.max(existing.openIssues || 0, repo.openIssues || 0);
    existing.watchers = Math.max(existing.watchers || 0, repo.watchers || 0);
    for (const field of ["description", "language", "topics", "createdAt", "updatedAt", "pushedAt"]) {
      if (!existing[field] && repo[field]) existing[field] = repo[field];
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Candidate pool output
// ---------------------------------------------------------------------------
async function saveCandidates(candidates) {
  const payload = {
    generatedAt: todayStr,
    count: candidates.length,
    repositories: candidates
  };
  await fs.writeFile(candidatesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已生成候选池：${candidatesPath} (${candidates.length})`);
}

// ---------------------------------------------------------------------------
// Snapshot (raw state only) + readers
// ---------------------------------------------------------------------------
async function saveSnapshot(date, candidates) {
  const payload = {
    date,
    generatedAt: new Date().toISOString(),
    count: candidates.length,
    repositories: candidates.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      url: c.url,
      description: c.description,
      stars: c.stars,
      forks: c.forks,
      openIssues: c.openIssues,
      watchers: c.watchers,
      language: c.language,
      topics: c.topics,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      pushedAt: c.pushedAt,
      isFork: c.isFork,
      isArchived: c.isArchived,
      discovery: c.discovery
    }))
  };
  await fs.writeFile(
    path.join(snapshotDir, `${date}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  console.log(`已生成快照：${path.join(snapshotDir, `${date}.json`)}`);
}

async function loadSnapshot(date) {
  try {
    const data = await readJson(path.join(snapshotDir, `${date}.json`));
    return normalizeSnapshotShape(data, date);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

// Find the snapshot closest to targetDate. If the exact date is missing, fall
// back to the nearest available date instead of failing.
function findClosestSnapshot(targetDate, snapshots) {
  const target = new Date(targetDate).getTime();
  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const snapshot of snapshots) {
    const diff = Math.abs(new Date(snapshot.date).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = snapshot;
    }
  }
  return best;
}

async function readAllSnapshots() {
  try {
    const files = (await fs.readdir(snapshotDir))
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort();
    const snapshots = [];
    for (const file of files) {
      const date = file.slice(0, 10);
      // Exclude today's file (not yet written) so delta is computed vs the last recorded state.
      if (date === todayStr) continue;
      const data = await readJson(path.join(snapshotDir, file));
      snapshots.push(normalizeSnapshotShape(data, date));
    }
    return snapshots;
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

function normalizeSnapshotShape(data, fallbackDate) {
  if (Array.isArray(data)) return { date: fallbackDate, repositories: data };
  return { date: data.date || fallbackDate, repositories: data.repositories || [] };
}

function findRepoInSnapshot(snapshot, fullName) {
  if (!snapshot) return null;
  return (snapshot.repositories || []).find((repo) => repo.fullName === fullName) || null;
}

// ---------------------------------------------------------------------------
// Ranking derivation (kept compatible with the existing React dashboard)
// ---------------------------------------------------------------------------
function attachDeltas(candidate, snapshots) {
  const dailyBase = findRepoInSnapshot(findClosestSnapshot(todayStr, snapshots), candidate.fullName);
  const monthlyTarget = shiftDays(today, -30).toISOString().slice(0, 10);
  const monthlyBase = findRepoInSnapshot(findClosestSnapshot(monthlyTarget, snapshots), candidate.fullName);

  const dailyBaseStars = dailyBase ? dailyBase.stars : candidate.stars;
  const monthlyBaseStars = monthlyBase ? monthlyBase.stars : candidate.stars;
  const dailyDelta = Math.max(0, (candidate.stars || 0) - (dailyBaseStars || 0));
  const monthlyDelta = Math.max(0, (candidate.stars || 0) - (monthlyBaseStars || 0));
  const recencyScore = daysSince(candidate.updatedAt) <= 14 ? 1000 : 0;

  return {
    ...candidate,
    dailyDelta,
    monthlyDelta,
    allScore: (candidate.stars || 0) + recencyScore
  };
}

function rankRepos(repos, { scoreKey, periodStarsKey = scoreKey, limit = 100 }) {
  return [...repos]
    .sort(
      (left, right) =>
        Number(right[scoreKey] || 0) - Number(left[scoreKey] || 0) || right.stars - left.stars
    )
    .slice(0, limit)
    .map((repo, index) => ({
      rank: index + 1,
      fullName: repo.fullName,
      url: repo.url,
      description: cleanDescription(repo.description),
      descriptionZh: repo.descriptionZh || null,
      businessSummary: (repo.description || "").trim() ? "" : (repo.businessSummary || summarizeBusinessValue(repo)),
      categoryIds: repo.categoryIds.length ? repo.categoryIds : ["developer"],
      language: repo.language || "Unknown",
      stars: repo.stars,
      periodStars: Number(repo[periodStarsKey] || 0),
      updatedAt: repo.updatedAt,
      topics: repo.topics || [],
      momentumScore: repo.momentumScore,
      signalType: repo.signalType,
      lifecycleType: repo.lifecycleType,
      confidence: repo.confidence,
      ageDays: repo.ageDays,
      growth: repo.growth,
      radar: repo.radar
    }));
}

// ---------------------------------------------------------------------------
// Category inference (content-based, drives the dashboard's category filter)
// ---------------------------------------------------------------------------
function inferCategories(repo) {
  const text = `${repo.fullName} ${cleanDescription(repo.description)} ${(repo.topics || []).join(" ")}`.toLowerCase();
  const matches = [];
  if (
    hasAny(text, [
      "ai-", "artificial intelligence", "machine-learning", "deep-learning", "agent",
      "agents", "rag", "llm", "llmops", "mcp", "model", "models", "multimodal",
      "generative", "generative-ai", "openai", "anthropic", "ollama", "embedding"
    ])
  ) {
    matches.push("ai");
  }
  if (
    hasAny(text, [
      "social", "social-media", "twitter", "x.com", "xhs", "xiaohongshu", "rednote",
      "douyin", "tiktok", "instagram", "youtube", "bilibili", "wechat", "weibo",
      "reddit", "telegram", "content creator"
    ])
  ) {
    matches.push("social");
  }
  if (
    hasAny(text, [
      "local-life", "local life", "food-delivery", "food delivery", "food-ordering",
      "food ordering", "takeaway", "takeout", "waimai", "restaurant", "restaurant-management",
      "restaurant management", "restaurant-menu", "reservation-system", "reservation system",
      "table-booking", "table booking", "pos system", "point-of-sale", "merchant",
      "multi-vendor", "multiple-restaurant", "ubereats", "doordash", "meituan",
      "eleme", "hotel", "hotel-booking", "hotel booking", "hotel-management",
      "property-management-system", "booking-engine", "travel", "tourism",
      "hospitality", "delivery-application", "courier", "last-mile", "last mile",
      "vehicle-routing", "vehicle routing", "route optimization", "dispatch",
      "logistics", "fleet", "home services", "housekeeping", "外卖", "餐饮",
      "到店", "团购", "家政", "保洁", "履约", "配送", "同城配送", "即时配送",
      "骑手", "派单", "调度", "商家端", "门店", "酒旅", "酒店", "民宿"
    ])
  ) {
    matches.push("local-life");
  }
  if (
    hasAny(text, [
      "developer", "framework", "sdk", "api", "cli", "devops", "testing",
      "test", "code", "lint", "static-analysis", "debug", "deploy", "kubernetes"
    ])
  ) {
    matches.push("developer");
  }
  if (
    hasAny(text, [
      "marketing", "growth", "seo", "crm", "campaign", "attribution", "ads",
      "advertising", "conversion", "funnel", "lead", "customer analytics"
    ])
  ) {
    matches.push("marketing");
  }
  if (
    hasAny(text, [
      "sentiment", "reputation", "media-monitoring", "media monitoring", "public opinion",
      "news", "press", "brand", "osint", "crisis", "monitoring"
    ])
  ) {
    matches.push("pr");
  }
  if (
    hasAny(text, [
      "legal", "contract", "compliance", "gdpr", "privacy", "policy", "audit",
      "risk", "security compliance", "license", "licensing"
    ])
  ) {
    matches.push("legal");
  }
  if (
    hasAny(text, [
      "finance", "financial", "accounting", "invoice", "billing", "payment",
      "trading", "portfolio", "stock", "crypto", "risk management", "tax"
    ])
  ) {
    matches.push("finance");
  }
  if (
    hasAny(text, [
      "design", "ui", "ux", "figma", "creative", "image", "video", "animation",
      "3d", "threejs", "webgl", "motion", "editor", "visual"
    ])
  ) {
    matches.push("design");
  }
  if (
    hasAny(text, [
      "workflow", "automation", "operations", "project management", "customer support",
      "knowledge base", "helpdesk", "dashboard", "alert", "alerts", "observability",
      "internal tool", "admin"
    ])
  ) {
    matches.push("ops");
  }
  return unique(matches);
}

function summarizeBusinessValue(repo) {
  const primaryCategory = (repo.categoryIds || [])[0];
  if (primaryCategory === "ai") return "适合构建 AI 应用、模型工作流、RAG、Agent 或 LLM 评测监控。";
  if (primaryCategory === "social") return "适合社媒平台内容生产、账号运营、发布管理、数据分析或趋势追踪。";
  if (primaryCategory === "local-life") return "适合外卖、餐饮到店、家政服务、履约配送、酒旅预订等本地生活业务。";
  if (primaryCategory === "developer") return "适合程序员提升开发、测试、部署、代码质量或工程协作效率。";
  if (primaryCategory === "marketing") return "适合营销市场团队做增长、投放、CRM、SEO、活动复盘或用户分析。";
  if (primaryCategory === "pr") return "适合公关传播团队做舆情监测、媒体分析、品牌声誉和传播复盘。";
  if (primaryCategory === "legal") return "适合法务合规场景里的合同分析、隐私合规、审计和风险管理。";
  if (primaryCategory === "finance") return "适合财务金融场景里的账单、支付、风控、投资组合或经营数据分析。";
  if (primaryCategory === "design") return "适合设计创意团队做 UI、视觉、视频、图片、3D 或动效生产。";
  if (primaryCategory === "ops") return "适合运营管理团队做流程自动化、项目协作、客服、知识库或监控告警。";
  return "适合进一步评估业务场景价值的开源项目。";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isUsefulCandidate(repo) {
  const description = cleanDescription(repo.description);
  const text = `${repo.full_name} ${description} ${(repo.topics || []).join(" ")}`.toLowerCase();
  if (!repo.full_name || !repo.html_url) return false;
  if (repo.fork || repo.archived) return false;
  if ((repo.description || "").length > 520) return false;
  if (
    hasAny(text, [
      "propaganda",
      "dictatorship",
      "censorship-circumvention",
      "political propaganda",
      "hate speech"
    ])
  ) {
    return false;
  }
  return true;
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function cleanDescription(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function daysSince(dateString) {
  if (!dateString) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - new Date(dateString).getTime()) / (24 * 60 * 60 * 1000));
}

function shiftDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function logBannerStart() {
  console.log("================================");
  console.log("GitHub Radar Collector");
  console.log(`Date:        ${todayStr}`);
  console.log(`Mode:        ${dryRun ? "dry-run" : "collect"}`);
  console.log(`Auth:        ${hasToken ? "token" : "anonymous"}`);
  console.log("================================");
}

function logBannerEnd({ planCount, rawCount, filteredCount, deduped, failedPlans }) {
  console.log("================================");
  console.log("GitHub Radar Collector");
  console.log(`Date:          ${todayStr}`);
  console.log(`Search Plans:  ${planCount}`);
  console.log(`Raw Results:   ${rawCount}`);
  console.log(`After Filter:  ${filteredCount}`);
  console.log(`After Dedup:   ${deduped}`);
  if (failedPlans) console.log(`Failed Plans:  ${failedPlans} (skipped, data retained)`);
  console.log(`Snapshot Saved: data/snapshots/${todayStr}.json`);
  console.log("================================");
}

function logMomentumBanner({ total, histStats, momentumRanking, signals, stats }) {
  console.log("================================");
  console.log("Radar Signals");
  console.log(`Repositories:           ${total}`);
  console.log("Historical comparisons:");
  console.log(`  24h available:        ${histStats.day1}`);
  console.log(`  7d  available:        ${histStats.day7}`);
  console.log(`  30d available:        ${histStats.day30}`);
  console.log("Signal counts:");
  console.log(`  Breakout:            ${stats.signalBreakdown.breakout}`);
  console.log(`  Fast Growing:        ${stats.signalBreakdown.fastGrowing}`);
  console.log(`  Hidden Gems:         ${stats.signalBreakdown.hiddenGems}`);
  console.log(`  New Projects:        ${stats.signalBreakdown.newProjects}`);
  console.log(`  AI Radar:            ${stats.signalBreakdown.aiRadar}`);
  console.log("Top Momentum:");
  momentumRanking.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.fullName}  Score: ${r.momentumScore}  Signal: ${r.signalType}/${r.lifecycleType}`);
  });
  console.log("================================");
}
