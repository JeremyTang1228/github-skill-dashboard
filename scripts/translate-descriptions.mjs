// ---------------------------------------------------------------------------
// Translate data/candidates.json descriptions in-place.
//
// Adds a `descriptionZh` field to each repo while preserving the original
// English `description`. Run this before `node scripts/generate-rankings.mjs`
// so that rankings.json also carries the Chinese descriptions.
//
// Required env:
//   TRANSLATION_PROVIDER=deepl|google|libre|openai
//   TRANSLATION_API_KEY=<your key>
// Optional env:
//   TRANSLATION_API_URL=<custom endpoint> (Libre / self-hosted OpenAI)
//   TRANSLATION_DELAY_MS=200
// ---------------------------------------------------------------------------
import fs from "node:fs/promises";
import { translateDescriptions } from "./lib/translation.mjs";

const CANDIDATES_PATH = "data/candidates.json";

async function main() {
  const provider = process.env.TRANSLATION_PROVIDER;
  if (!provider) {
    console.error("Error: set TRANSLATION_PROVIDER to deepl, google, libre or openai.");
    console.error("Example: TRANSLATION_PROVIDER=deepl TRANSLATION_API_KEY=xxx node scripts/translate-descriptions.mjs");
    process.exit(1);
  }

  console.log(`[translate-descriptions] reading ${CANDIDATES_PATH}`);
  const raw = await fs.readFile(CANDIDATES_PATH, "utf-8");
  const candidates = JSON.parse(raw);

  const translated = await translateDescriptions(candidates);

  const withZh = translated.repositories.filter((r) => r.descriptionZh).length;
  const total = translated.repositories.length;
  console.log(`[translate-descriptions] ${withZh}/${total} repos have descriptionZh`);

  await fs.writeFile(CANDIDATES_PATH, JSON.stringify(translated, null, 2), "utf-8");
  console.log(`[translate-descriptions] wrote ${CANDIDATES_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
