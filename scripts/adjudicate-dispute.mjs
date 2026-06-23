// Adjudicate one quiz dispute. Run by the `dispute` GitHub Action when the
// Worker fires a `dispute` repository_dispatch.
//
// Env: DISPUTE_ID, COURSE_ID, APP_BASE_URL, INTERNAL_TOKEN, ANTHROPIC_API_KEY,
//      MAIL_FROM, GMAIL_APP_PASSWORD, MAIL_TO (optional).

import nodemailer from "nodemailer";
import { client, structured } from "../lib/claude.mjs";
import { applyRuling, rulingEmail } from "../lib/dispute.mjs";
import { fetchCourse, saveCourse, fetchDispute, resolveDispute } from "./lib/course-store.mjs";

const DISPUTE_ID = process.env.DISPUTE_ID;
if (!DISPUTE_ID) { console.error("DISPUTE_ID is required"); process.exit(1); }

const RULING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["learner_correct", "ambiguous", "question_flawed", "stands"] },
    upheld: { type: "boolean" },
    reasoning: { type: "string" },
    correctedQuestion: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        correctIndex: { type: "integer" },
        explanation: { type: "string" },
      },
      required: ["question", "options", "correctIndex", "explanation"],
    },
  },
  required: ["verdict", "upheld", "reasoning", "correctedQuestion"],
};

function rulingPrompt(p, language) {
  const opts = (p.options || []).map((o, i) => `${i}) ${o}`).join("\n");
  return (
    `You are a neutral exam adjudicator. A learner disputes one multiple-choice quiz question. ` +
    `Judge fairly — do NOT assume the question is correct just because it exists — but keep a real bar: ` +
    `uphold ONLY if the learner's answer is genuinely acceptable, or the question is genuinely flawed ` +
    `(ambiguous, more than one correct option, wrong answer key, or a factual error). ` +
    `If the marked option is the single best answer and the learner is simply wrong, the verdict is "stands".\n\n` +
    `Question: ${p.question}\nOptions (0-based):\n${opts}\n` +
    `Marked-correct option index: ${p.correctIndex}\nLearner chose option index: ${p.chosenIndex}\n` +
    `The question's own explanation: ${p.explanation}\n` +
    `Learner's reason for disputing: "${p.reason}"\n\n` +
    `Return: verdict ("learner_correct" | "ambiguous" | "question_flawed" | "stands"); ` +
    `upheld (true unless verdict is "stands"); reasoning (1-3 sentences addressed TO the learner, teaching why, in ${language}); ` +
    `correctedQuestion (if upheld, a cleaned-up version with fixed wording/options/correctIndex/explanation; if it stands, return the original question unchanged). ` +
    `All learner-facing text in ${language}.`
  );
}

async function main() {
  const dispute = await fetchDispute(DISPUTE_ID);
  if (dispute.status !== "open") { console.log(`Dispute ${DISPUTE_ID} already ${dispute.status} — skipping.`); return; }
  const curriculum = await fetchCourse(dispute.course_id);
  const language = (curriculum.settings && curriculum.settings.language) || "English";

  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const ruling = await structured(client(), rulingPrompt(dispute.payload, language), RULING_SCHEMA, 2000);

  const at = new Date().toISOString();
  const shaped = { module: dispute.module, attempt: dispute.attempt, questionIndex: dispute.question_index, payload: dispute.payload };
  const result = applyRuling(curriculum, shaped, ruling, at);

  if (result.curriculum !== curriculum) await saveCourse(dispute.course_id, result.curriculum);
  await resolveDispute(DISPUTE_ID, { status: ruling.upheld ? "upheld" : "rejected", ruling });

  // Email the learner the verdict.
  const from = process.env.MAIL_FROM;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = (curriculum.settings && curriculum.settings.email) || process.env.MAIL_TO || from;
  if (from && pass && to) {
    const { subject, text, html } = rulingEmail(shaped, ruling, { regraded: result.regraded, passedNow: result.passedNow }, language);
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user: from, pass } });
    await transport.sendMail({ from, to, subject, text, html });
    console.log(`Emailed ruling (${ruling.verdict}) to ${to}.`);
  } else {
    console.log(`Ruling ${ruling.verdict}; mail not configured, skipped email.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
