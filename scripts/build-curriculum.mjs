// Triggered by the "assessment-result" repository_dispatch. Has Claude judge the
// learner's level from the answer pattern, builds the outline with the chunk-size
// ladder, and writes the full curriculum to D1 (status active).
//
// Env: ASSESSMENT_RESULTS (JSON [{level, correct}]), ANTHROPIC_API_KEY, COURSE_ID

import { client, structured } from "../lib/claude.mjs";
import { buildLadder } from "../lib/ladder.mjs";
import { fetchCourse, saveCourse } from "../lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  const curriculum = await fetchCourse(COURSE_ID);
  const results = JSON.parse(process.env.ASSESSMENT_RESULTS || "[]");
  if (!Array.isArray(results) || results.length === 0) {
    console.error("ASSESSMENT_RESULTS missing.");
    process.exit(1);
  }
  const c = client();

  // 1. Judge the level from the pattern (Claude judges).
  const judged = await structured(
    c,
    `A learner took a laddered placement check for "${curriculum.subject}". Each item lists the difficulty band ` +
      `it probes and whether they answered correctly:\n${JSON.stringify(results)}\n\n` +
      `Estimate their expertise level as an integer 1–10: find the band where they cross from reliably correct to ` +
      `incorrect — that's the level — nudging up for hard items they nailed and down for easy ones they missed. ` +
      `Treat a lone easy miss amid harder correct answers as a slip. Return {level, rationale}.`,
    {
      type: "object",
      additionalProperties: false,
      properties: { level: { type: "integer" }, rationale: { type: "string" } },
      required: ["level", "rationale"],
    },
    800,
  );
  const level = Math.min(10, Math.max(1, judged.level));

  // 2. Build the outline sized to the chunk-size ladder.
  const ladder = buildLadder(level, curriculum.settings.chunkMinutes);
  const { modules } = await structured(
    c,
    `Build a ${ladder.length}-module course outline in ${curriculum.settings.language} for "${curriculum.subject}"` +
      `${curriculum.angle ? ` (angle: ${curriculum.angle})` : ""}, pitched at learner level ${level}/10. ` +
      `Each module is { title, summary } (summary one line). Order them so they deepen toward mastery. ` +
      `Ground them in these notes:\n---\n${curriculum.researchContext || ""}\n---`,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        modules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { title: { type: "string" }, summary: { type: "string" } },
            required: ["title", "summary"],
          },
        },
      },
      required: ["modules"],
    },
    8000,
  );

  const outline = modules.slice(0, ladder.length).map((m, i) => ({
    id: i + 1,
    title: m.title,
    summary: m.summary,
    targetLevel: ladder[i],
  }));

  curriculum.startLevel = level;
  curriculum.level = level;
  curriculum.outline = outline;
  curriculum.progress = { currentModule: 1, attempt: 1, status: "active", delivered: [], lastQuiz: null };
  curriculum.placement = { results, rationale: judged.rationale };

  await saveCourse(COURSE_ID, curriculum);
  console.log(`Judged level ${level} (${judged.rationale}). Built ${outline.length} modules; ladder ${ladder.join(",")}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
