// Triggered by the "assessment-result" repository_dispatch. Has Claude judge the
// learner's level from the answer pattern, builds the outline with the chunk-size
// ladder, and writes the full curriculum to D1 (status active).
//
// Env: ASSESSMENT_RESULTS (JSON [{level, correct}]), ANTHROPIC_API_KEY, COURSE_ID

import { client, structured } from "../lib/claude.mjs";
import { buildLadder, placementLevel } from "../lib/ladder.mjs";
import { registerDirective } from "../lib/register.mjs";
import { fetchCourse, saveCourse } from "./lib/course-store.mjs";
import { adjustLevel, levelBandLabel, domainLabel } from "../lib/calibration.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  const curriculum = await fetchCourse(COURSE_ID);
  const adjust = (process.env.LEVEL_ADJUST === "up" || process.env.LEVEL_ADJUST === "down") ? process.env.LEVEL_ADJUST : null;
  const c = client();
  const domain = domainLabel(curriculum.settings.domain);

  // 1. Decide the level: judge from the placement (normal) or shift one band (adjust).
  let level, rationale, results = null;
  if (adjust) {
    level = adjustLevel(curriculum.level, adjust);
    rationale = `Re-pitched ${adjust} to level ${level} at the learner's request.`;
  } else {
    results = JSON.parse(process.env.ASSESSMENT_RESULTS || "[]");
    if (!Array.isArray(results) || results.length === 0) {
      console.error("ASSESSMENT_RESULTS missing.");
      process.exit(1);
    }
    const judged = await structured(
      c,
      `A learner took a laddered placement check for "${curriculum.subject}". Each item lists the difficulty band ` +
        `it probes and whether they answered correctly:\n${JSON.stringify(results)}\n\n` +
        `Estimate their expertise level as an integer 1–10: find the band where they cross from reliably correct to ` +
        `incorrect — that's the level — nudging up for hard items they nailed and down for easy ones they missed. ` +
        `Treat a lone easy miss amid harder correct answers as a slip. Return {level, rationale}.`,
      { type: "object", additionalProperties: false, properties: { level: { type: "integer" }, rationale: { type: "string" } }, required: ["level", "rationale"] },
      800,
    );
    level = placementLevel(judged.level);
    rationale = judged.rationale;
  }

  // 2. Build the outline sized to the chunk-size ladder.
  const ladder = buildLadder(level, curriculum.settings.chunkMinutes);
  const { modules } = await structured(
    c,
    `Build a ${ladder.length}-module course outline in ${curriculum.settings.language} for "${curriculum.subject}"` +
      `${curriculum.angle ? ` (angle: ${curriculum.angle})` : ""}, pitched at learner level ${level}/10. ` +
      `The learner's background field is ${domain}; choose examples and framing that fit it. ` +
      `Each module is { title, summary } (summary one line). Order them so they deepen toward mastery. ` +
      `${registerDirective(curriculum.settings.educationLevel)} ` +
      `Ground them in these notes:\n---\n${curriculum.researchContext || ""}\n---`,
    { type: "object", additionalProperties: false, properties: { modules: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, summary: { type: "string" } }, required: ["title", "summary"] } } }, required: ["modules"] },
    8000,
  );

  const outline = modules.slice(0, ladder.length).map((m, i) => ({ id: i + 1, title: m.title, summary: m.summary, targetLevel: ladder[i] }));

  // 3. Syllabus front-matter — title, subtitle, introduction, prerequisites, bibliography.
  const front = await structured(
    c,
    `Write the front-matter for a course in ${curriculum.settings.language} on "${curriculum.subject}"` +
      `${curriculum.angle ? ` (angle: ${curriculum.angle})` : ""}, pitched at learner level ${level}/10 for a learner whose background field is ${domain} (${curriculum.settings.educationLevel}). ` +
      `Return {title, subtitle, introduction, prerequisites, bibliography}. "title" is an engaging course title; "subtitle" is a one-line tagline. ` +
      `"introduction" is 2–3 short paragraphs (plain text, a blank line between paragraphs) that define the main terms the learner will meet and lay out how the modules build toward mastery. ` +
      `"prerequisites" is a list of 3–6 short, concrete background assumptions this course makes (e.g. "Comfort with linear algebra and complex numbers — undergraduate math"), honest about what a ${domain} learner at this level may be missing. ` +
      `"bibliography" is 5–8 real, well-known sources (books or major essays) on the subject, each { title, author, note } with a one-line note on what it offers; use genuine works and do not invent citations. ` +
      `${registerDirective(curriculum.settings.educationLevel)} ` +
      `Ground it in this module outline: ${JSON.stringify(outline.map((m) => m.title))} and these notes:\n---\n${curriculum.researchContext || ""}\n---`,
    { type: "object", additionalProperties: false, properties: { title: { type: "string" }, subtitle: { type: "string" }, introduction: { type: "string" }, prerequisites: { type: "array", items: { type: "string" } }, bibliography: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, author: { type: "string" }, note: { type: "string" } }, required: ["title", "author", "note"] } } }, required: ["title", "subtitle", "introduction", "prerequisites", "bibliography"] },
    3000,
  );

  curriculum.startLevel = level;
  curriculum.level = level;
  curriculum.outline = outline;
  curriculum.syllabus = { title: front.title, subtitle: front.subtitle, introduction: front.introduction, prerequisites: front.prerequisites, bibliography: front.bibliography, level: levelBandLabel(level) };
  curriculum.progress = { currentModule: 1, attempt: 1, status: "awaiting-approval", delivered: [], lastQuiz: null };
  if (!adjust) curriculum.placement = { results, rationale };

  await saveCourse(COURSE_ID, curriculum);
  console.log(`${adjust ? "Re-pitched" : "Judged"} level ${level} (${rationale}). Built ${outline.length} modules; ladder ${ladder.join(",")}. Awaiting approval.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
