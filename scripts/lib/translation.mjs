// ---------------------------------------------------------------------------
// Translation helpers for repository descriptions.
//
// Supports DeepL, Google Cloud Translation, LibreTranslate and OpenAI-compatible
// endpoints. Results are cached in data/translations.json keyed by the original
// English text, so identical descriptions across repos only cost one translation
// and re-runs are cheap.
//
// Usage:
//   import { translateDescriptions } from "./lib/translation.mjs";
//   const translated = await translateDescriptions(candidates, { provider: "deepl" });
//
// Environment variables (all optional unless a provider is chosen):
//   TRANSLATION_PROVIDER=deepl|google|libre|openai
//   TRANSLATION_API_KEY=<key>
//   TRANSLATION_API_URL=<custom endpoint> (Libre / self-hosted OpenAI)
//   TRANSLATION_DELAY_MS=200              (politeness delay between batches)
// ---------------------------------------------------------------------------
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_PATH = path.resolve("data", "translations.json");

export const PROVIDERS = {
  deepl: translateDeepL,
  google: translateGoogle,
  libre: translateLibre,
  openai: translateOpenAI,
};

export async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveCache(cache) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

function looksChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeInput(input) {
  if (Array.isArray(input)) return { candidates: input, isArray: true };
  if (input && Array.isArray(input.repositories)) {
    return { candidates: input.repositories, isArray: false, original: input };
  }
  throw new Error("translateDescriptions expects an array of repos or { repositories: [...] }");
}

function denormalize(repos, { isArray, original }) {
  if (isArray) return repos;
  return { ...original, repositories: repos };
}

async function translateDeepL(texts, { apiKey, apiUrl = "https://api-free.deepl.com/v2/translate" }) {
  const body = new URLSearchParams();
  texts.forEach((t) => body.append("text", t));
  body.append("target_lang", "ZH");
  body.append("source_lang", "EN");
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`DeepL error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.translations.map((t) => t.text);
}

async function translateGoogle(texts, { apiKey, apiUrl = "https://translation.googleapis.com/language/translate/v2" }) {
  const res = await fetch(`${apiUrl}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: texts, source: "en", target: "zh-CN", format: "text" }),
  });
  if (!res.ok) throw new Error(`Google error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.translations.map((t) => t.translatedText);
}

async function translateLibre(texts, { apiKey, apiUrl }) {
  if (!apiUrl) throw new Error("LibreTranslate requires TRANSLATION_API_URL");
  const body = { q: texts, source: "en", target: "zh", format: "text" };
  if (apiKey) body.api_key = apiKey;
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LibreTranslate error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (Array.isArray(data)) return data.map((d) => d.translatedText);
  if (Array.isArray(data.translatedText)) return data.translatedText;
  return [data.translatedText];
}

async function translateOpenAI(texts, { apiKey, apiUrl = "https://api.openai.com/v1/chat/completions", model = "gpt-4o-mini" }) {
  const prompt =
    `Translate each of the following English GitHub repository descriptions into concise, natural Chinese. ` +
    `Preserve technical terms (e.g. RAG, LLM, Agent) in English or transliterate them only when common. ` +
    `Return a single JSON array of strings in the same order, with no markdown formatting.\n\n` +
    JSON.stringify(texts, null, 2);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "[]";
  const match = content.match(/\[[\s\S]*\]/);
  const parsed = JSON.parse(match ? match[0] : content);
  if (!Array.isArray(parsed) || parsed.length !== texts.length) {
    throw new Error(`OpenAI returned ${parsed?.length} items for ${texts.length} texts`);
  }
  return parsed;
}

/**
 * Translate repository descriptions in-place, adding a `descriptionZh` field while
 * preserving the original `description`. Already-Chinese or empty descriptions are
 * skipped. Unique descriptions are translated only once thanks to the cache.
 */
export async function translateDescriptions(input, options = {}) {
  const { candidates, isArray, original } = normalizeInput(input);

  const providerName = options.provider || process.env.TRANSLATION_PROVIDER;
  if (!providerName || providerName === "none") {
    // No provider configured: still re-apply any cached translations so previously
    // translated Chinese descriptions survive a plain re-run (they would otherwise be
    // wiped, because collectCandidates() returns fresh English-only data). New repos
    // without a cache entry stay English until a provider run translates them.
    const cache = await loadCache();
    const restored = candidates.map((repo) => {
      const desc = (repo.description || "").trim();
      if (!desc || looksChinese(desc)) return repo;
      const zh = cache[desc];
      return zh && zh !== desc ? { ...repo, descriptionZh: zh } : repo;
    });
    return denormalize(restored, { isArray, original });
  }

  const provider = PROVIDERS[providerName.toLowerCase()];
  if (!provider) throw new Error(`Unknown translation provider: ${providerName}`);

  const apiKey = options.apiKey || process.env.TRANSLATION_API_KEY || "";
  const apiUrl = options.apiUrl || process.env.TRANSLATION_API_URL;
  const delayMs = Number(options.delayMs ?? process.env.TRANSLATION_DELAY_MS ?? 200);
  const batchSize = Number(options.batchSize ?? 50);

  const cache = await loadCache();

  // Collect unique English descriptions still needing translation.
  const uniqueToTranslate = new Set();
  const descByRepo = new Map();
  for (const repo of candidates) {
    const desc = (repo.description || "").trim();
    descByRepo.set(repo, desc);
    if (!desc || looksChinese(desc) || cache[desc]) continue;
    uniqueToTranslate.add(desc);
  }

  if (uniqueToTranslate.size > 0) {
    const texts = [...uniqueToTranslate];
    console.log(`[translate] ${texts.length} unique descriptions to translate via ${providerName}`);

    let done = 0;
    for (const batch of chunkArray(texts, batchSize)) {
      const results = await provider(batch, { apiKey, apiUrl });
      if (!Array.isArray(results) || results.length !== batch.length) {
        throw new Error(`Provider returned ${results?.length} results for ${batch.length} inputs`);
      }
      for (let i = 0; i < batch.length; i++) {
        cache[batch[i]] = results[i];
      }
      done += batch.length;
      await saveCache(cache);
      if (delayMs > 0 && done < texts.length) await sleep(delayMs);
    }
  }

  const translated = candidates.map((repo) => {
    const desc = descByRepo.get(repo);
    if (!desc || looksChinese(desc)) return repo;
    const zh = cache[desc];
    return zh && zh !== desc ? { ...repo, descriptionZh: zh } : repo;
  });

  return denormalize(translated, { isArray, original });
}
