// Apply a quiz result to curriculum.json. Run by the record-quiz GitHub Action
// when the quiz helper fires a repository_dispatch; the workflow maps the
// client_payload into these env vars and commits the change afterward.
//
// Env: QUIZ_MODULE, QUIZ_ATTEMPT, QUIZ_SCORE, QUIZ_TOTAL

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordQuiz } from "../lib/progress.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(ROOT, "curriculum.json");

function intEnv(name) {
  const v = parseInt(process.env[name] ?? "", 10);
  if (Number.isNaN(v)) {
    console.error(`Missing/invalid ${name}`);
    process.exit(1);
  }
  return v;
}

const curriculum = JSON.parse(fs.readFileSync(file, "utf8"));
let missed = [];
try {
  const m = JSON.parse(process.env.QUIZ_MISSED || "[]");
  if (Array.isArray(m)) missed = m.map(String);
} catch {
  missed = [];
}

const result = {
  module: intEnv("QUIZ_MODULE"),
  attempt: parseInt(process.env.QUIZ_ATTEMPT ?? "1", 10) || 1,
  score: intEnv("QUIZ_SCORE"),
  total: intEnv("QUIZ_TOTAL"),
  missed,
  at: new Date().toISOString(),
};

const next = recordQuiz(curriculum, result);
if (next === curriculum) {
  console.log(`Stale or non-matching result for module ${result.module} (attempt ${result.attempt}) — ignored.`);
  process.exit(0);
}

fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
console.log(
  `Recorded ${result.score}/${result.total} on module ${result.module}. ` +
  `Now: module ${next.progress.currentModule}, attempt ${next.progress.attempt}, level ${next.level}, status ${next.progress.status}.`,
);
