// Triggered by the "onboard" repository_dispatch. Takes the learner's subject +
// settings, researches the topic, generates a laddered placement check, renders
// the assessment page, and writes a partial curriculum.json (awaiting-assessment).
//
// Env: ONBOARD_PAYLOAD (JSON of the form fields), ANTHROPIC_API_KEY, QUIZ_WEBHOOK_URL
// Writes: lessons/assessment.html, curriculum.json (partial)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { client, research, structured } from "../lib/claude.mjs";
import { renderAssessmentHtml } from "../lib/render-assessment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

  fs.mkdirSync(path.join(ROOT, "lessons"), { recursive: true });
  const html = renderAssessmentHtml({
    questions,
    webhookUrl: process.env.QUIZ_WEBHOOK_URL || "",
    languageCode: p.languageCode || "en",
    subject: p.subject,
  });
  fs.writeFileSync(path.join(ROOT, "lessons", "assessment.html"), html);

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
      email: process.env.MAIL_TO || "",
      model: process.env.MYSENSEI_MODEL || "claude-sonnet-4-6",
      passThreshold: 0.7,
    },
    researchContext: notes,
    outline: [],
    progress: { currentModule: 1, attempt: 1, status: "awaiting-assessment", delivered: [], lastQuiz: null },
    trackHistory: [],
  };
  fs.writeFileSync(path.join(ROOT, "curriculum.json"), JSON.stringify(curriculum, null, 2) + "\n");
  console.log(`Onboarded "${p.subject}" — wrote assessment page + partial curriculum.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
