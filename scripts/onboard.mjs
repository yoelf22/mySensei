// Triggered by the "onboard" repository_dispatch. Takes the learner's subject +
// settings, researches the topic, generates a laddered placement check, renders
// the assessment page, and saves a partial curriculum to D1 (awaiting-assessment).
//
// Env: ONBOARD_PAYLOAD (JSON of the form fields), ANTHROPIC_API_KEY, COURSE_ID,
//      APP_BASE_URL, INTERNAL_TOKEN

import { client, research, structured } from "../lib/claude.mjs";
import { renderAssessmentHtml } from "../lib/render-assessment.mjs";
import { fetchCourse, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }
const QUESTION_COUNT = 7;

const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          level: { type: "integer" },
        },
        required: ["question", "options", "correctIndex", "level"],
      },
    },
  },
  required: ["questions"],
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  const p = JSON.parse(process.env.ONBOARD_PAYLOAD || "{}");
  if (!p.subject) {
    console.error("ONBOARD_PAYLOAD missing subject.");
    process.exit(1);
  }
  const c = client();

  // The lesson/placement recipient is the course owner (the logged-in,
  // invited learner). No email is collected on the form — read it from D1.
  const existing = await fetchCourse(COURSE_ID);

  const notes = await research(
    c,
    `Research "${p.subject}"${p.angle ? ` with this angle: ${p.angle}` : ""}, for a course in ${p.language}. ` +
      `Summarize the area's sub-topics and what a beginner vs. an expert focuses on. Keep it tight.`,
  );

  const { questions } = await structured(
    c,
    `Write ${QUESTION_COUNT} multiple-choice placement-check questions in ${p.language} about "${p.subject}"` +
      `${p.angle ? ` (angle: ${p.angle})` : ""}, ordered EASY → HARD so each probes a higher expertise band. ` +
      `Tag each with "level" = the difficulty band 1–10 it targets (ascending across the set, spanning low to 10). ` +
      `Each question has 3–4 options and a 0-based correctIndex. Make the hard ones genuinely discriminating for an expert. ` +
      `Ground them in these research notes:\n---\n${notes}\n---`,
    QUESTION_SCHEMA,
    4000,
  );

  const html = renderAssessmentHtml({
    questions,
    webhookUrl: submitUrl(),
    courseId: COURSE_ID,
    languageCode: p.languageCode || "en",
    subject: p.subject,
  });
  await savePage(COURSE_ID, "assessment", html);

  const curriculum = {
    version: 1,
    subject: p.subject,
    angle: p.angle || "",
    settings: {
      language: p.language || "English",
      languageCode: p.languageCode || "en",
      chunkMinutes: Number(p.chunkMinutes) || 10,
      cadence: p.cadence === "weekly" ? "weekly" : "daily",
      deliveryTime: p.deliveryTime || "07:00",
      timezone: p.timezone || "UTC",
      workweekDays: Array.isArray(p.workweekDays) ? p.workweekDays : [0, 1, 2, 3, 4, 5, 6],
      email: existing.ownerEmail || process.env.MAIL_TO || "",
      model: process.env.MYSENSEI_MODEL || "claude-sonnet-4-6",
      passThreshold: 0.7,
    },
    researchContext: notes,
    assessment: { questions },
    outline: [],
    progress: { currentModule: 1, attempt: 1, status: "awaiting-assessment", delivered: [], lastQuiz: null },
    trackHistory: [],
  };
  await saveCourse(COURSE_ID, curriculum);
  console.log(`Onboarded "${p.subject}" — saved assessment page + partial curriculum to D1.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
