// Pure dispute logic: apply an adjudication ruling to a curriculum, build the
// learner-facing ruling email, and build the generator's "avoid these" line.
// No I/O — the adjudicate script wires Claude + the store + email around this.

import { amendQuiz } from "./progress.mjs";

/**
 * Apply Claude's ruling to a curriculum.
 * dispute: { module, attempt, questionIndex, payload }
 * payload: { question, options, correctIndex, chosenIndex, concept, explanation, reason }
 * ruling:  { verdict, upheld, reasoning, correctedQuestion }
 * Returns { curriculum, correction, regraded, passedNow }.
 */
export function applyRuling(curriculum, dispute, ruling, at) {
  if (!ruling.upheld) {
    return { curriculum, correction: null, regraded: false, passedNow: false };
  }

  const before = curriculum.progress && curriculum.progress.lastQuiz;
  const beforePassed = !!(before && before.passed);
  let next = amendQuiz(curriculum, {
    module: dispute.module,
    attempt: dispute.attempt,
    creditConcept: dispute.payload.concept,
  });
  const regraded = next !== curriculum;
  const passedNow = regraded && !!next.progress.lastQuiz?.passed && !beforePassed;

  // Clone even when the regrade didn't apply, so the correction still persists.
  if (next === curriculum) next = structuredClone(curriculum);

  const correction = {
    module: dispute.module,
    questionIndex: dispute.questionIndex,
    original: {
      question: dispute.payload.question,
      options: dispute.payload.options,
      correctIndex: dispute.payload.correctIndex,
    },
    corrected: ruling.correctedQuestion || null,
    verdict: ruling.verdict,
    reason: dispute.payload.reason,
    at,
  };
  next.progress.corrections = [...(next.progress.corrections || []), correction];
  return { curriculum: next, correction, regraded, passedNow };
}

/**
 * Build the learner-facing ruling email. The localized teaching lives in
 * ruling.reasoning (already generated in the course language); the wrapper is
 * English, matching the project's other transactional emails.
 */
export function rulingEmail(dispute, ruling, { regraded, passedNow }, language) {
  const cq = ruling.correctedQuestion || {};
  const upheld = !!ruling.upheld;
  const subject = upheld ? "mySensei — your dispute was upheld" : "mySensei — about your disputed question";

  const scoreLine = passedNow
    ? "Your score was updated and this module now counts as passed — the next lesson will move on."
    : regraded
    ? "Your score for this question was updated."
    : "Your score didn't change, but thanks — the flag has been recorded.";

  // Only show a corrected answer when the ruling actually carried a well-formed one.
  const correctedText =
    upheld && Array.isArray(cq.options) && Number.isInteger(cq.correctIndex)
      ? `\nCorrected answer: ${cq.options[cq.correctIndex]}\n${cq.explanation || ""}\n`
      : "";

  const text =
    `You disputed this question:\n"${dispute.payload.question}"\n\n` +
    `Your note: "${dispute.payload.reason}"\n\n` +
    `Verdict: ${ruling.reasoning}\n` +
    correctedText +
    (upheld ? `\n${scoreLine}\n` : "");

  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const correctedHtml =
    upheld && Array.isArray(cq.options) && Number.isInteger(cq.correctIndex)
      ? `<p><b>Corrected answer:</b> ${esc(cq.options[cq.correctIndex])}<br>${esc(cq.explanation || "")}</p>`
      : "";
  const html =
    `<p>You disputed this question:</p><blockquote>${esc(dispute.payload.question)}</blockquote>` +
    `<p><b>Your note:</b> ${esc(dispute.payload.reason)}</p>` +
    `<p><b>Verdict:</b> ${esc(ruling.reasoning)}</p>` +
    correctedHtml +
    (upheld ? `<p>${esc(scoreLine)}</p>` : "");

  return { subject, text, html };
}

/** A prompt line telling the generator to avoid recently-flawed questions. */
export function pitfallsDirective(curriculum) {
  const cs = (curriculum.progress && curriculum.progress.corrections) || [];
  if (!cs.length) return "";
  const lines = cs
    .slice(-5)
    .map((c) => `- "${c.original?.question || ""}" (issue: ${c.verdict})`)
    .join("\n");
  return `Some earlier quiz questions were found flawed; do NOT repeat these problems when writing new questions:\n${lines}\n`;
}
