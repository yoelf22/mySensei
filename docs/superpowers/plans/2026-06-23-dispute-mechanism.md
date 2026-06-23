# Quiz Dispute Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a learner contest a graded quiz question; Claude adjudicates automatically and, when upheld, regrades the learner and logs a correction that feeds forward into future lessons.

**Architecture:** The lesson page posts a dispute (question + learner's reason) to the Worker, which stores it in a new `disputes` table and fires a `dispute` repository_dispatch carrying only the dispute id (sidestepping GitHub's 10-property `client_payload` cap). A new `dispute` GitHub Action runs `adjudicate-dispute.mjs`: Claude rules with a skeptical prompt (default "stands"), an upheld ruling amends the recorded quiz via a new pure `amendQuiz`, logs the correction under `progress.corrections`, marks the dispute resolved, and emails the learner the verdict. The lesson generator reads `progress.corrections` to avoid repeating flawed questions.

**Tech Stack:** Node 20 ESM (`lib/`, `scripts/`), `node:test` for lib/script tests; Cloudflare Worker + D1 (`worker/src/`), vitest + `cloudflare:test` for worker tests; `@anthropic-ai/sdk` (model `claude-sonnet-4-6`); nodemailer (Gmail SMTP); GitHub Actions `repository_dispatch`.

## Global Constraints

- **Node ESM only**, `"type": "module"`. Run lib/script tests with `npm test` (`node --test`). Run worker tests with `npm test` inside `worker/` (`vitest run`).
- **Model:** `claude-sonnet-4-6` via the shared helpers in `lib/claude.mjs` (`client`, `structured`, `textOf`). Never hardcode another model id.
- **`client_payload` cap:** GitHub rejects more than 10 top-level properties. Dispute dispatch must carry only `{ courseId, disputeId }`.
- **Persistence boundary:** the Worker's `saveCurriculum` (worker/src/db.mjs) only writes fixed columns — `subject, angle, settings, status, start_level, level, research, assessment, outline, progress, syllabus`. Anything new that must persist on a course goes **inside `progress`** (a JSON blob). Corrections therefore live at `curriculum.progress.corrections`.
- **Pure vs I/O:** `lib/*.mjs` are pure (no network/fs) and fully unit-tested. Scripts in `scripts/*.mjs` do I/O and wire the pure pieces together.
- **RTL + language:** all learner-facing copy is generated/labelled in the course language (`settings.language`, `settings.languageCode`); `lib/render-lesson.mjs` already has `en` + `he` label tables — extend both.
- **Commits:** small, one per task, on `main` (this repo commits specs/plans/code directly to `main`). End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/progress.mjs` | Pure progress state machine | **Modify** — add `amendQuiz` |
| `lib/dispute.mjs` | Pure dispute logic: apply a ruling, build the ruling email, build the generator pitfalls directive | **Create** |
| `lib/dispute.test.mjs` | Tests for `lib/dispute.mjs` | **Create** |
| `lib/progress.test.mjs` | Tests for progress | **Modify** — add `amendQuiz` tests |
| `lib/render-lesson.mjs` | Render the lesson HTML + quiz; add per-question dispute UI | **Modify** |
| `lib/render-lesson.test.mjs` | Tests for the renderer | **Modify** |
| `worker/migrations/0003_disputes.sql` | `disputes` table | **Create** |
| `worker/src/db.mjs` | D1 access; add `createDispute`/`getDispute`/`resolveDispute` | **Modify** |
| `worker/src/dispatch.mjs` | Build dispatch payloads; add `buildDisputeRecord` + `postDispatch` | **Modify** |
| `worker/src/worker.mjs` | HTTP routing; add `/submit` dispute branch | **Modify** |
| `worker/src/internal.mjs` | Internal API; add `/internal/dispute/:id` GET + PUT | **Modify** |
| `worker/test/disputes.test.mjs` | Worker dispute tests (db + routes) | **Create** |
| `scripts/lib/course-store.mjs` | Worker internal-API client; add `fetchDispute`/`resolveDispute` | **Modify** |
| `scripts/adjudicate-dispute.mjs` | The dispute Action entrypoint: Claude ruling → apply → resolve → email | **Create** |
| `scripts/generate-lesson.mjs` | Lesson generator; feed `pitfallsDirective` into the prompt | **Modify** |
| `package.json` | add `"adjudicate"` script | **Modify** |
| `.github/workflows/dispute.yml` | Run the adjudicator on a `dispute` dispatch | **Create** |
| `SETUP.md` | Note the new migration + workflow | **Modify** |

---

## Task 1: `amendQuiz` — regrade a recorded quiz after an upheld dispute

**Files:**
- Modify: `lib/progress.mjs`
- Test: `lib/progress.test.mjs`

**Interfaces:**
- Consumes: `moduleById`, `quizPassed` (already in `lib/progress.mjs`).
- Produces: `amendQuiz(curriculum, { module, attempt, creditConcept }) => curriculum` (NEW object on change, the SAME object when nothing applies). Credits one question (+1, capped at total) on the recorded `progress.lastQuiz` **only if** it matches `module`+`attempt` and had not already passed; if the corrected score now passes, advances exactly like a real pass; removes `creditConcept` from `lastQuiz.missedConcepts`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/progress.test.mjs` (after the existing imports, extend the import list to include `amendQuiz`):

```javascript
import {
  recordQuiz,
  amendQuiz,
  nextTarget,
  quizPassed,
  atMastery,
  needsMoreModules,
  alreadyDelivered,
} from "./progress.mjs";

// --- amendQuiz ---------------------------------------------------------------

function failedCurriculum() {
  // module 1 was failed 1/3; recordQuiz left currentModule=1, attempt=2.
  const c = baseCurriculum();
  c.progress.currentModule = 1;
  c.progress.attempt = 2;
  c.progress.lastQuiz = { module: 1, attempt: 1, score: 1, total: 3, passed: false, missedConcepts: ["grip", "stance"], at: "t" };
  return c;
}

test("amendQuiz credits a failed quiz and, when it now passes, advances", () => {
  const next = amendQuiz(failedCurriculum(), { module: 1, attempt: 1, creditConcept: "grip" });
  assert.notEqual(next, failedCurriculum());
  assert.equal(next.progress.lastQuiz.score, 2); // 1 -> 2 of 3 = pass (>=0.7? 0.66 no)
  // 2/3 = 0.666 < 0.7 so still failing:
  assert.equal(next.progress.lastQuiz.passed, false);
  assert.equal(next.progress.currentModule, 1);
  assert.deepEqual(next.progress.lastQuiz.missedConcepts, ["stance"]); // credited concept removed
});

test("amendQuiz that flips fail->pass advances module, resets attempt, raises level", () => {
  const c = failedCurriculum();
  c.progress.lastQuiz.score = 2; // 2/3, credit -> 3/3 pass
  const next = amendQuiz(c, { module: 1, attempt: 1, creditConcept: "grip" });
  assert.equal(next.progress.lastQuiz.score, 3);
  assert.equal(next.progress.lastQuiz.passed, true);
  assert.equal(next.progress.currentModule, 2);
  assert.equal(next.progress.attempt, 1);
  assert.equal(next.level, 5); // module 1 targetLevel
});

test("amendQuiz ignores a stale/moved-on dispute (no matching lastQuiz)", () => {
  const c = failedCurriculum();
  const same = amendQuiz(c, { module: 1, attempt: 99, creditConcept: "grip" });
  assert.equal(same, c);
});

test("amendQuiz ignores a quiz that already passed", () => {
  const c = failedCurriculum();
  c.progress.lastQuiz.passed = true;
  const same = amendQuiz(c, { module: 1, attempt: 1, creditConcept: "grip" });
  assert.equal(same, c);
});

test("amendQuiz caps the credited score at total", () => {
  const c = failedCurriculum();
  c.progress.lastQuiz.score = 3; // already at total (but passed=false contrived)
  const next = amendQuiz(c, { module: 1, attempt: 1, creditConcept: "grip" });
  assert.equal(next.progress.lastQuiz.score, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `amendQuiz is not a function` (or import error).

- [ ] **Step 3: Implement `amendQuiz`**

Append to `lib/progress.mjs` (after `recordQuiz`):

```javascript
/**
 * Credit one disputed question on the most recent recorded quiz and re-evaluate.
 * Returns a NEW curriculum when it applies, the SAME object otherwise.
 *
 * Only the recorded `progress.lastQuiz` is amendable, and only when it matches
 * the disputed module+attempt and had not already passed — a dispute that lands
 * after the learner moved on (lastQuiz no longer matches) or on an already-passed
 * quiz is ignored, so we never pull the learner backward.
 *
 * amendment: { module, attempt, creditConcept }
 */
export function amendQuiz(curriculum, amendment) {
  const lq = curriculum.progress && curriculum.progress.lastQuiz;
  if (!lq) return curriculum;
  if (lq.module !== amendment.module || (lq.attempt ?? 1) !== (amendment.attempt ?? 1)) return curriculum;
  if (lq.passed) return curriculum;

  const newScore = Math.min(lq.total, lq.score + 1);
  const passed = quizPassed(curriculum, newScore, lq.total);
  const next = structuredClone(curriculum);
  next.progress.lastQuiz.score = newScore;
  next.progress.lastQuiz.passed = passed;
  if (Array.isArray(next.progress.lastQuiz.missedConcepts)) {
    next.progress.lastQuiz.missedConcepts = next.progress.lastQuiz.missedConcepts.filter(
      (c) => c !== amendment.creditConcept,
    );
  }
  if (!passed) return next;

  // Now passing: advance from the disputed module exactly like recordQuiz's pass.
  const mod = moduleById(curriculum, amendment.module);
  const targetLevel = mod?.targetLevel ?? next.level + 1;
  next.level = Math.min(10, Math.max(next.level, targetLevel));
  next.progress.currentModule = amendment.module + 1;
  next.progress.attempt = 1;
  if (next.level >= 10) next.progress.status = "awaiting-specialization";
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all progress tests, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/progress.mjs lib/progress.test.mjs
git commit -m "feat: amendQuiz — regrade a recorded quiz after an upheld dispute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/dispute.mjs` — apply a ruling, build the email, build the pitfalls directive

**Files:**
- Create: `lib/dispute.mjs`
- Test: `lib/dispute.test.mjs`

**Interfaces:**
- Consumes: `amendQuiz` from `./progress.mjs`.
- Produces:
  - `applyRuling(curriculum, dispute, ruling, at) => { curriculum, correction, regraded, passedNow }` where `dispute = { module, attempt, questionIndex, payload }`, `payload = { question, options, correctIndex, chosenIndex, concept, explanation, reason }`, `ruling = { verdict, upheld, reasoning, correctedQuestion }`. When `!upheld`: returns the input curriculum unchanged, `correction:null`. When upheld: attempts `amendQuiz`, always logs the correction under `progress.corrections`, returns the new curriculum.
  - `rulingEmail(dispute, ruling, { regraded, passedNow }, language) => { subject, text, html }`.
  - `pitfallsDirective(curriculum) => string` — a prompt line listing recent corrected questions to avoid, or `""`.

- [ ] **Step 1: Write the failing tests**

Create `lib/dispute.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRuling, rulingEmail, pitfallsDirective } from "./dispute.mjs";

function curriculum() {
  return {
    level: 4,
    settings: { passThreshold: 0.7, language: "English" },
    outline: [{ id: 1, title: "A", targetLevel: 5 }, { id: 2, title: "B", targetLevel: 6 }],
    progress: {
      currentModule: 1,
      attempt: 2,
      lastQuiz: { module: 1, attempt: 1, score: 2, total: 3, passed: false, missedConcepts: ["grip"] },
    },
  };
}

const dispute = {
  module: 1,
  attempt: 1,
  questionIndex: 0,
  payload: { question: "Q?", options: ["a", "b", "c"], correctIndex: 1, chosenIndex: 0, concept: "grip", explanation: "because b", reason: "a is also valid" },
};

test("applyRuling: rejected leaves the curriculum unchanged and logs no correction", () => {
  const c = curriculum();
  const ruling = { verdict: "stands", upheld: false, reasoning: "b is the single best answer", correctedQuestion: dispute.payload };
  const r = applyRuling(c, dispute, ruling, "2026-06-23T00:00:00Z");
  assert.equal(r.curriculum, c);
  assert.equal(r.correction, null);
  assert.equal(r.regraded, false);
});

test("applyRuling: upheld credits the quiz (flips to pass) and logs a correction", () => {
  const c = curriculum();
  const ruling = { verdict: "learner_correct", upheld: true, reasoning: "you're right, a works too", correctedQuestion: { question: "Q?", options: ["a", "b", "c"], correctIndex: 0, explanation: "a is correct" } };
  const r = applyRuling(c, dispute, ruling, "2026-06-23T00:00:00Z");
  assert.equal(r.regraded, true);
  assert.equal(r.passedNow, true);
  assert.equal(r.curriculum.progress.lastQuiz.score, 3);
  assert.equal(r.curriculum.progress.currentModule, 2);
  assert.equal(r.curriculum.progress.corrections.length, 1);
  assert.equal(r.curriculum.progress.corrections[0].verdict, "learner_correct");
  assert.equal(r.curriculum.progress.corrections[0].at, "2026-06-23T00:00:00Z");
});

test("applyRuling: upheld but stale still logs the correction without regrading", () => {
  const c = curriculum();
  const stale = { ...dispute, attempt: 99 };
  const ruling = { verdict: "question_flawed", upheld: true, reasoning: "key was wrong", correctedQuestion: dispute.payload };
  const r = applyRuling(c, stale, ruling, "t");
  assert.equal(r.regraded, false);
  assert.equal(r.curriculum.progress.corrections.length, 1);
  assert.notEqual(r.curriculum, c); // cloned so the correction persists
});

test("rulingEmail: upheld mentions the corrected answer; rejected explains it stands", () => {
  const up = rulingEmail(dispute, { verdict: "learner_correct", upheld: true, reasoning: "you're right", correctedQuestion: { question: "Q?", options: ["a", "b", "c"], correctIndex: 0, explanation: "a" } }, { regraded: true, passedNow: true }, "English");
  assert.match(up.subject, /upheld/i);
  assert.match(up.text, /you're right/);
  assert.match(up.html, /<a|<p/);
  const no = rulingEmail(dispute, { verdict: "stands", upheld: false, reasoning: "b is best", correctedQuestion: dispute.payload }, { regraded: false, passedNow: false }, "English");
  assert.match(no.text, /b is best/);
});

test("pitfallsDirective: empty without corrections, lists them when present", () => {
  assert.equal(pitfallsDirective(curriculum()), "");
  const c = curriculum();
  c.progress.corrections = [{ original: { question: "bad Q" }, verdict: "question_flawed" }];
  assert.match(pitfallsDirective(c), /bad Q/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find `./dispute.mjs`.

- [ ] **Step 3: Implement `lib/dispute.mjs`**

Create `lib/dispute.mjs`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (the 5 new dispute tests + all existing).

- [ ] **Step 5: Commit**

```bash
git add lib/dispute.mjs lib/dispute.test.mjs
git commit -m "feat: lib/dispute — apply ruling, ruling email, pitfalls directive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lesson page dispute UI

**Files:**
- Modify: `lib/render-lesson.mjs`
- Test: `lib/render-lesson.test.mjs`

**Interfaces:**
- Consumes: existing `meta` (`module`, `attempt`, `correct[]`, `concepts[]`, `explanations[]`, `webhook`, `courseId`) and `LABELS`.
- Produces: after grading, each question shows an "I think this is wrong" control that reveals a required textarea + Send button and POSTs `{ type:"dispute", courseId, module, attempt, questionIndex, question, options, correctIndex, chosenIndex, concept, explanation, reason }` to `meta.webhook`. New `en`+`he` labels: `disputeLink`, `disputePrompt`, `disputeSend`, `disputeSent`, `disputeEmpty`, `disputeOffline`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/render-lesson.test.mjs` (the existing file already builds `curriculum`/`lesson` and calls `renderLessonHtml`; add a test that inspects the HTML string). Append:

```javascript
test("lesson HTML wires the per-question dispute UI", () => {
  const html = renderLessonHtml({
    curriculum: { subject: "X", settings: { languageCode: "en", language: "English", passThreshold: 0.7 } },
    lesson: { moduleId: 2, attempt: 1, title: "T", sections: [], quiz: [
      { question: "Q1", options: ["a", "b"], correctIndex: 1, concept: "c1", explanation: "e1" },
    ] },
    webhookUrl: "https://app/submit",
    courseId: "abc123",
  });
  // labels present
  assert.match(html, /I think this is wrong/);
  assert.match(html, /What's wrong with this question/);
  // the dispute POST is wired in the inline script
  assert.match(html, /type:\s*"dispute"/);
  assert.match(html, /questionIndex/);
});

test("Hebrew lesson carries Hebrew dispute labels", () => {
  const html = renderLessonHtml({
    curriculum: { subject: "X", settings: { languageCode: "he", language: "Hebrew", passThreshold: 0.7 } },
    lesson: { moduleId: 1, attempt: 1, title: "T", sections: [], quiz: [
      { question: "ש", options: ["א", "ב"], correctIndex: 0, concept: "ג", explanation: "ד" },
    ] },
    webhookUrl: "https://app/submit",
    courseId: "abc123",
  });
  assert.match(html, /לדעתי זו טעות/); // he.disputeLink, set in Step 3
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — "I think this is wrong" / `type:"dispute"` not found.

- [ ] **Step 3: Add labels, CSS, and the dispute script**

In `lib/render-lesson.mjs`, extend both label tables (add the six keys to `en` and `he`):

```javascript
const LABELS = {
  en: { learnMore: "Learn more", drillsTitle: "Practice", showSolution: "Show solution", quizTitle: "Quick check", submit: "Submit quiz", passed: "You've got it. The next lesson will move on.", failed: "Not quite — the next lesson will revisit this with different material.", answerAll: "Please answer every question first.", sent: "Result sent.", offline: "Could not reach the server — check your connection and resubmit.", correctAnswer: "Correct answer:", disputeLink: "I think this is wrong", disputePrompt: "What's wrong with this question?", disputeSend: "Send", disputeSent: "Thanks — we'll take another look and email you the verdict.", disputeEmpty: "Please say what's wrong first.", disputeOffline: "Could not send — check your connection and try again." },
  he: { learnMore: "למדו עוד", drillsTitle: "תרגול", showSolution: "הצג פתרון", quizTitle: "בדיקה מהירה", submit: "שלח מבדק", passed: "הבנת. השיעור הבא ימשיך הלאה.", failed: "לא לגמרי — השיעור הבא יחזור על זה בחומר אחר.", answerAll: "נא לענות על כל השאלות.", sent: "התוצאה נשלחה.", offline: "לא התקבלה גישה לשרת — בדקו את החיבור ושלחו שוב.", correctAnswer: "תשובה נכונה:", disputeLink: "לדעתי זו טעות", disputePrompt: "מה לא בסדר בשאלה הזו?", disputeSend: "שליחה", disputeSent: "תודה — נבדוק שוב ונשלח לכם את ההכרעה במייל.", disputeEmpty: "כתבו תחילה מה לא בסדר.", disputeOffline: "השליחה נכשלה — בדקו את החיבור ונסו שוב." },
};
```

Add CSS inside the `<style>` block (near the `.fb` rules):

```css
  .dispute { font-family:system-ui,sans-serif; font-size:.85rem; margin:.4rem 0 0; }
  .dispute button.disp-open { background:none; border:0; color:var(--muted); text-decoration:underline; cursor:pointer; padding:0; font:inherit; }
  .dispute textarea { display:block; width:100%; margin:.5rem 0; padding:.5rem; border:1px solid var(--line); border-radius:.4rem; font:inherit; }
  .dispute .disp-send { background:var(--accent); color:#fff; border:0; border-radius:.4rem; padding:.4rem 1rem; cursor:pointer; }
  .dispute .disp-done { color:#1a7f37; }
```

Extend the inline `<script>` so that after the per-question feedback loop has run (inside the `submit` handler, after the `for` loop that appends `fb`), it attaches a dispute control to each fieldset. Insert this block immediately **before** `var passed = ...`:

```javascript
    for (var di = 0; di < meta.total; di++) {
      (function (qi) {
        var fs = fsList[qi];
        var chosen = parseInt(fs.querySelector('input[name="q' + qi + '"]:checked').value, 10);
        var wrap = document.createElement("div");
        wrap.className = "dispute";
        var open = document.createElement("button");
        open.type = "button";
        open.className = "disp-open";
        open.textContent = L.disputeLink;
        wrap.appendChild(open);
        fs.appendChild(wrap);
        open.addEventListener("click", function () {
          open.remove();
          var ta = document.createElement("textarea");
          ta.rows = 2;
          ta.placeholder = L.disputePrompt;
          var send = document.createElement("button");
          send.type = "button";
          send.className = "disp-send";
          send.textContent = L.disputeSend;
          var note = document.createElement("span");
          note.className = "fb";
          wrap.appendChild(ta);
          wrap.appendChild(send);
          wrap.appendChild(note);
          send.addEventListener("click", function () {
            var reason = ta.value.trim();
            if (!reason) { note.textContent = L.disputeEmpty; note.className = "fb no"; return; }
            send.disabled = true;
            var opts = fs.querySelectorAll("label.opt span");
            var optionText = [];
            for (var o = 0; o < opts.length; o++) optionText.push(opts[o].textContent);
            var legend = fs.querySelector("legend").textContent.replace(/^\s*\d+\.\s*/, "");
            fetch(meta.webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "dispute", courseId: meta.courseId, module: meta.module, attempt: meta.attempt, questionIndex: qi, question: legend, options: optionText, correctIndex: meta.correct[qi], chosenIndex: chosen, concept: meta.concepts[qi], explanation: meta.explanations[qi], reason: reason }),
            }).then(function () {
              ta.remove(); send.remove();
              note.textContent = L.disputeSent; note.className = "fb disp-done";
            }).catch(function () {
              send.disabled = false;
              note.textContent = L.disputeOffline; note.className = "fb no";
            });
          });
        });
      })(di);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. (Adjust the `he.disputeLink` regex in the test to the exact Hebrew string above: `לדעתי זו טעות`.)

- [ ] **Step 5: Commit**

```bash
git add lib/render-lesson.mjs lib/render-lesson.test.mjs
git commit -m "feat: per-question dispute UI on the lesson page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `disputes` table + D1 access functions

**Files:**
- Create: `worker/migrations/0003_disputes.sql`
- Modify: `worker/src/db.mjs`
- Test: `worker/test/disputes.test.mjs`

**Interfaces:**
- Consumes: `env.DB` (D1), `now()`, `randomId()` (already in `worker/src/db.mjs`).
- Produces:
  - `createDispute(env, { courseId, module, attempt, questionIndex, payload }) => { id, duplicate }` — inserts a row; on the unique `(course_id,module,attempt,question_index)` conflict returns the existing id with `duplicate:true`.
  - `getDispute(env, id) => { id, course_id, module, attempt, question_index, payload(obj), status, ruling(obj|null), created_at, resolved_at } | null`.
  - `resolveDispute(env, id, status, ruling) => void` — sets status, `ruling` (JSON), `resolved_at`.

- [ ] **Step 1: Create the migration**

Create `worker/migrations/0003_disputes.sql`:

```sql
-- A learner's challenge to one graded quiz question. One per (course, module,
-- attempt, question) — the unique constraint blocks duplicate disputes.
CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  module INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  question_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  ruling TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (course_id, module, attempt, question_index)
);
CREATE INDEX idx_disputes_course ON disputes(course_id);
```

- [ ] **Step 2: Write the failing tests**

Create `worker/test/disputes.test.mjs`:

```javascript
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createDispute, getDispute, resolveDispute } from "../src/db.mjs";

const payload = { question: "Q?", options: ["a", "b"], correctIndex: 1, chosenIndex: 0, concept: "c", explanation: "e", reason: "a works too" };

beforeEach(async () => { await env.DB.exec("DELETE FROM disputes;"); });

describe("disputes db", () => {
  it("creates, reads, and resolves a dispute", async () => {
    const { id, duplicate } = await createDispute(env, { courseId: "c1", module: 1, attempt: 1, questionIndex: 0, payload });
    expect(duplicate).toBe(false);
    const row = await getDispute(env, id);
    expect(row.course_id).toBe("c1");
    expect(row.status).toBe("open");
    expect(row.payload.reason).toBe("a works too");
    expect(row.ruling).toBe(null);

    await resolveDispute(env, id, "upheld", { verdict: "learner_correct", upheld: true });
    const after = await getDispute(env, id);
    expect(after.status).toBe("upheld");
    expect(after.ruling.verdict).toBe("learner_correct");
    expect(after.resolved_at).toBeTruthy();
  });

  it("rejects a duplicate dispute on the same question+attempt", async () => {
    const a = await createDispute(env, { courseId: "c1", module: 1, attempt: 1, questionIndex: 0, payload });
    const b = await createDispute(env, { courseId: "c1", module: 1, attempt: 1, questionIndex: 0, payload });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it("getDispute returns null for an unknown id", async () => {
    expect(await getDispute(env, "nope")).toBe(null);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `createDispute is not a function` (and/or no `disputes` table; the test harness applies migrations from `worker/migrations`, so the new file is picked up automatically).

- [ ] **Step 4: Implement the db functions**

Append to `worker/src/db.mjs`:

```javascript
export async function createDispute(env, { courseId, module, attempt, questionIndex, payload }) {
  const existing = await env.DB.prepare(
    "SELECT id FROM disputes WHERE course_id=? AND module=? AND attempt=? AND question_index=?",
  ).bind(courseId, module, attempt, questionIndex).first();
  if (existing) return { id: existing.id, duplicate: true };

  const id = randomId();
  await env.DB.prepare(
    "INSERT INTO disputes(id, course_id, module, attempt, question_index, payload, status, created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(id, courseId, module, attempt, questionIndex, JSON.stringify(payload), "open", now()).run();
  return { id, duplicate: false };
}

export async function getDispute(env, id) {
  const row = await env.DB.prepare("SELECT * FROM disputes WHERE id = ?").bind(id).first();
  if (!row) return null;
  return {
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : null,
    ruling: row.ruling ? JSON.parse(row.ruling) : null,
  };
}

export async function resolveDispute(env, id, status, ruling) {
  await env.DB.prepare(
    "UPDATE disputes SET status=?, ruling=?, resolved_at=? WHERE id=?",
  ).bind(status, JSON.stringify(ruling ?? null), now(), id).run();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (the 3 new dispute-db tests + all existing worker tests).

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/0003_disputes.sql worker/src/db.mjs worker/test/disputes.test.mjs
git commit -m "feat: disputes table + createDispute/getDispute/resolveDispute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Worker `/submit` dispute branch

**Files:**
- Modify: `worker/src/dispatch.mjs`
- Modify: `worker/src/worker.mjs`
- Test: `worker/test/disputes.test.mjs` (extend)

**Interfaces:**
- Consumes: `createDispute` (Task 4); `env.GITHUB_OWNER/GITHUB_REPO/GITHUB_TOKEN`.
- Produces:
  - `buildDisputeRecord(body) => { error } | { courseId, module, attempt, questionIndex, payload }` (pure, in `dispatch.mjs`).
  - `postDispatch(env, event_type, client_payload) => Response` (the GitHub dispatch fetch, in `dispatch.mjs`).
  - `/submit` with `body.type === "dispute"`: validates, stores, dispatches `event_type:"dispute"` with `{ courseId, disputeId }`; a duplicate returns `{ ok:true, duplicate:true }` without dispatching.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/disputes.test.mjs`:

```javascript
import worker from "../src/worker.mjs";
import { buildDisputeRecord } from "../src/dispatch.mjs";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

describe("buildDisputeRecord", () => {
  const ok = { type: "dispute", courseId: "c1", module: 1, attempt: 1, questionIndex: 0, question: "Q", options: ["a", "b"], correctIndex: 1, chosenIndex: 0, concept: "c", explanation: "e", reason: "a works" };
  it("accepts a well-formed dispute", () => {
    const r = buildDisputeRecord(ok);
    expect(r.error).toBeUndefined();
    expect(r.payload.reason).toBe("a works");
    expect(r.questionIndex).toBe(0);
  });
  it("rejects a missing reason", () => {
    expect(buildDisputeRecord({ ...ok, reason: "  " }).error).toBeTruthy();
  });
  it("rejects a missing courseId", () => {
    expect(buildDisputeRecord({ ...ok, courseId: "" }).error).toBeTruthy();
  });
  it("rejects a non-integer questionIndex", () => {
    expect(buildDisputeRecord({ ...ok, questionIndex: "x" }).error).toBeTruthy();
  });
});

describe("/submit dispute branch", () => {
  const E = { ...env, GITHUB_OWNER: "o", GITHUB_REPO: "r", GITHUB_TOKEN: "t" };
  const body = { type: "dispute", courseId: "c1", module: 1, attempt: 1, questionIndex: 0, question: "Q", options: ["a", "b"], correctIndex: 1, chosenIndex: 0, concept: "c", explanation: "e", reason: "a works too" };
  async function submit(env2, b) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), env2, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("stores the dispute and reports a duplicate on the second submit", async () => {
    await env.DB.exec("DELETE FROM disputes;");
    // Stub the GitHub dispatch so no real network call happens.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 204 });
    try {
      const r1 = await submit(E, body);
      expect(r1.status).toBe(200);
      const j1 = await r1.json();
      expect(j1.ok).toBe(true);
      expect(j1.duplicate).toBeFalsy();

      const r2 = await submit(E, body);
      const j2 = await r2.json();
      expect(j2.duplicate).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
    const { results } = await env.DB.prepare("SELECT id FROM disputes WHERE course_id='c1'").all();
    expect(results.length).toBe(1);
  });

  it("rejects an invalid dispute with 400", async () => {
    const r = await submit(E, { ...body, reason: "" });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `buildDisputeRecord is not a function`; `/submit` dispute path 404/400 mismatch.

- [ ] **Step 3: Implement `buildDisputeRecord` + `postDispatch` in `dispatch.mjs`**

Append to `worker/src/dispatch.mjs`:

```javascript
const int = (v) => Number(v);

export function buildDisputeRecord(body) {
  const courseId = String(body.courseId || "");
  if (!courseId) return { error: "missing courseId" };
  const module = int(body.module), attempt = int(body.attempt) || 1, questionIndex = int(body.questionIndex);
  if (![module, questionIndex].every(Number.isInteger) || questionIndex < 0) return { error: "invalid module/questionIndex" };
  const reason = String(body.reason || "").trim();
  if (!reason) return { error: "missing reason" };
  if (!Array.isArray(body.options) || !body.options.length) return { error: "missing options" };
  if (!Number.isInteger(int(body.correctIndex))) return { error: "invalid correctIndex" };

  return {
    courseId, module, attempt, questionIndex,
    payload: {
      question: String(body.question || ""),
      options: body.options.map(String).slice(0, 10),
      correctIndex: int(body.correctIndex),
      chosenIndex: Number.isInteger(int(body.chosenIndex)) ? int(body.chosenIndex) : -1,
      concept: String(body.concept || ""),
      explanation: String(body.explanation || ""),
      reason: reason.slice(0, 2000),
    },
  };
}

export async function postDispatch(env, event_type, client_payload) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "mySensei-worker", "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, client_payload }),
  });
}
```

- [ ] **Step 4: Add the dispute branch to `/submit` in `worker.mjs`**

Add the import (extend the existing `dispatch.mjs` import on line 9):

```javascript
import { buildDispatch, buildDisputeRecord, postDispatch } from "./dispatch.mjs";
```

Add `createDispute` to the existing `db.mjs` import on line 2 (append to the destructured list):

```javascript
import { isAllowlisted, createCourse, listCourses, getCourse, setStatus, countActive, getPage, courseToCurriculum, addToAllowlist, listAllowlist, removeFromAllowlist, createDispute } from "./db.mjs";
```

Then, inside the `if (method === "POST" && pathname === "/submit") {` block, **before** `const d = buildDispatch(body);`, insert:

```javascript
      if (body.type === "dispute") {
        const rec = buildDisputeRecord(body);
        if (rec.error) return json({ error: rec.error }, 400, CORS);
        const { id, duplicate } = await createDispute(env, rec);
        if (duplicate) return json({ ok: true, duplicate: true }, 200, CORS);
        const gh2 = await postDispatch(env, "dispute", { courseId: rec.courseId, disputeId: id });
        if (!gh2.ok) return json({ error: "dispatch failed", status: gh2.status }, 502, CORS);
        return json({ ok: true }, 200, CORS);
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (all dispute tests + existing).

- [ ] **Step 6: Commit**

```bash
git add worker/src/dispatch.mjs worker/src/worker.mjs worker/test/disputes.test.mjs
git commit -m "feat: /submit dispute branch — store + dispatch by id

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Internal API for the adjudicator

**Files:**
- Modify: `worker/src/internal.mjs`
- Test: `worker/test/disputes.test.mjs` (extend)

**Interfaces:**
- Consumes: `getDispute`, `resolveDispute` (Task 4); `internalOk` (already in `internal.mjs`).
- Produces: `GET /internal/dispute/:id` → the dispute row (or 404); `PUT /internal/dispute/:id` with `{ status, ruling }` → resolves it. Both require the internal token.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/disputes.test.mjs`:

```javascript
describe("internal dispute API", () => {
  const TOKEN = "tok-int";
  const E = { ...env, INTERNAL_TOKEN: TOKEN };
  const auth = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };
  async function call(path, init) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://app" + path, init), E, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("GET returns the dispute; PUT resolves it; 401 without the token", async () => {
    await env.DB.exec("DELETE FROM disputes;");
    const { id } = await createDispute(env, { courseId: "c9", module: 1, attempt: 1, questionIndex: 0, payload });
    expect((await call(`/internal/dispute/${id}`, {})).status).toBe(401);

    const got = await call(`/internal/dispute/${id}`, { headers: auth });
    expect(got.status).toBe(200);
    expect((await got.json()).course_id).toBe("c9");

    const put = await call(`/internal/dispute/${id}`, { method: "PUT", headers: auth, body: JSON.stringify({ status: "rejected", ruling: { verdict: "stands", upheld: false } }) });
    expect(put.status).toBe(200);
    const after = await getDispute(env, id);
    expect(after.status).toBe("rejected");
  });

  it("GET an unknown dispute id is 404", async () => {
    expect((await call(`/internal/dispute/nope`, { headers: auth })).status).toBe(404);
  });
});
```

(Add `createDispute` to the test file's `db.mjs` import if not already imported there.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `/internal/dispute/...` returns 404 (handler not present → falls through to course regex which doesn't match → `handleInternal` returns null → main routing 404s).

- [ ] **Step 3: Implement the dispute routes in `internal.mjs`**

Extend the `db.mjs` import on line 2:

```javascript
import { getCourse, courseToCurriculum, saveCurriculum, putPage, setLastError, getDispute, resolveDispute } from "./db.mjs";
```

At the very top of `handleInternal` (before the existing `const m = url.pathname.match(...)` for courses), add:

```javascript
  const dm = url.pathname.match(/^\/internal\/dispute\/([a-z0-9]+)$/);
  if (dm) {
    if (!internalOk(request, env)) return json({ error: "unauthorized" }, 401);
    const did = dm[1];
    if (request.method === "GET") {
      const row = await getDispute(env, did);
      if (!row) return json({ error: "not found" }, 404);
      return json(row);
    }
    if (request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON" }, 400); }
      await resolveDispute(env, did, String(body.status || "open"), body.ruling ?? null);
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/internal.mjs worker/test/disputes.test.mjs
git commit -m "feat: internal /dispute/:id GET + PUT for the adjudicator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: The adjudicator script + store client + generator feed-forward

**Files:**
- Modify: `scripts/lib/course-store.mjs`
- Create: `scripts/adjudicate-dispute.mjs`
- Modify: `scripts/generate-lesson.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `applyRuling`, `rulingEmail` (Task 2); `pitfallsDirective` (Task 2); `amendQuiz` indirectly; `client`/`structured`/`textOf` from `lib/claude.mjs`; `fetchCourse`/`saveCourse` from `scripts/lib/course-store.mjs`; `nodemailer`.
- Produces: `fetchDispute(disputeId)` + `resolveDispute(disputeId, { status, ruling })` in `course-store.mjs`; `scripts/adjudicate-dispute.mjs` entrypoint; `npm run adjudicate`.

- [ ] **Step 1: Add the store client helpers**

Append to `scripts/lib/course-store.mjs` (uses the existing `base()`/`token()` helpers):

```javascript
export async function fetchDispute(disputeId) {
  const r = await fetch(`${base()}/internal/dispute/${disputeId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!r.ok) throw new Error(`fetchDispute ${disputeId}: ${r.status}`);
  return r.json();
}

export async function resolveDispute(disputeId, { status, ruling }) {
  const r = await fetch(`${base()}/internal/dispute/${disputeId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status, ruling }),
  });
  if (!r.ok) throw new Error(`resolveDispute ${disputeId}: ${r.status}`);
}
```

- [ ] **Step 2: Write the adjudicator script**

Create `scripts/adjudicate-dispute.mjs`:

```javascript
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
```

- [ ] **Step 3: Verify the script parses**

Run: `node --check scripts/adjudicate-dispute.mjs`
Expected: no output, exit 0 (syntax OK). (The script's behavior is covered by the pure-unit tests in Tasks 1–2; it does live I/O, so it isn't unit-tested here — it's verified end-to-end in the manual check after Task 8.)

- [ ] **Step 4: Wire `pitfallsDirective` into the generator**

In `scripts/generate-lesson.mjs`, add the import near the other `lib` imports (alongside the existing `import { renderLessonHtml } ...`):

```javascript
import { pitfallsDirective } from "../lib/dispute.mjs";
```

In `authorLesson`, just after the `reinforce` line, add:

```javascript
  const pitfalls = pitfallsDirective(curriculum);
```

Then include it in the prompt string — change the `Register: ...` line so the directives are concatenated:

```javascript
    `Register: ${registerDirective(s.educationLevel)}\n${retry}${reinforce}${pitfalls}\n` +
```

- [ ] **Step 5: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
    "adjudicate": "node scripts/adjudicate-dispute.mjs",
```

- [ ] **Step 6: Run the full test suite (nothing should regress)**

Run: `npm test`
Expected: PASS (generator change is import + prompt concat; `pitfallsDirective` is already tested in Task 2).

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/course-store.mjs scripts/adjudicate-dispute.mjs scripts/generate-lesson.mjs package.json
git commit -m "feat: adjudicate-dispute script + generator pitfalls feed-forward

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: The `dispute` workflow + setup notes

**Files:**
- Create: `.github/workflows/dispute.yml`
- Modify: `SETUP.md`

**Interfaces:**
- Consumes: `npm run adjudicate` (Task 7); the existing `scripts/report-failure.mjs` (already in the repo) for the failure path; the same secrets/vars the other workflows use.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/dispute.yml` (modelled on `deliver-lesson.yml`):

```yaml
name: dispute
on:
  repository_dispatch:
    types: [dispute]
concurrency:
  group: dispute-${{ github.event.client_payload.disputeId }}
  cancel-in-progress: false
permissions:
  contents: read
jobs:
  adjudicate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install --no-audit --no-fund
      - name: Adjudicate the dispute
        env:
          DISPUTE_ID: ${{ github.event.client_payload.disputeId }}
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          MAIL_TO: ${{ vars.MAIL_TO }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: npm run --silent adjudicate

      - name: Report failure to owner
        if: failure()
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
          OWNER_EMAIL: ${{ vars.OWNER_EMAIL }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: node scripts/report-failure.mjs
```

- [ ] **Step 2: Note the migration + workflow in `SETUP.md`**

In `SETUP.md`, find the deployment/migration section and add a bullet (match the surrounding style):

```markdown
- **Disputes:** apply the new D1 migration after pulling this change —
  `cd worker && npx wrangler d1 migrations apply <DB_NAME> --remote` — then
  redeploy the worker (`npm run deploy`). The `dispute` workflow needs the same
  secrets/vars the other workflows already use (`ANTHROPIC_API_KEY`,
  `INTERNAL_TOKEN`, `APP_BASE_URL`, `MAIL_FROM`, `MAIL_TO`, `GMAIL_APP_PASSWORD`,
  `OWNER_EMAIL`) — no new ones.
```

(If `SETUP.md` has no migration section, add a short `## Disputes` section at the end with the same content.)

- [ ] **Step 3: Final full-suite check**

Run: `npm test` (repo root) and `cd worker && npm test`
Expected: PASS in both.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/dispute.yml SETUP.md
git commit -m "feat: dispute workflow + setup notes for the dispute mechanism

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual end-to-end verification (after deploy + migration)**

Per `docs/superpowers/specs/2026-06-23-dispute-mechanism-design.md`:
1. Apply the migration and deploy the worker (Step 2 commands).
2. Open a live lesson page, submit the quiz, click "I think this is wrong" on a question, type a reason, Send → expect the confirmation line.
3. Confirm a `disputes` row exists (`wrangler d1 execute <DB> --remote --command "SELECT id,status FROM disputes"`).
4. Confirm the `dispute` workflow ran (GitHub Actions tab) and the row's `status` became `upheld`/`rejected`.
5. Confirm the ruling email arrived; if upheld, confirm the course `progress` shows the corrected score and a `corrections` entry.
6. Try disputing the same question again → expect the duplicate confirmation, no second workflow run.

---

## Self-Review

**Spec coverage** (against `2026-06-23-dispute-mechanism-design.md`):
- Learner UI, every question, required reason, confirmation, email-not-live → Task 3. ✓
- Worker stores + dispatches id; one-per-question → Tasks 4, 5. ✓
- Claude skeptical adjudication, default "stands" → Task 7 (`rulingPrompt`, schema). ✓
- Upheld → regrade (`amendQuiz`, Task 1) + correction log (`applyRuling`, Task 2). ✓
- "Fix the question" = log-and-feed-forward → `progress.corrections` + `pitfallsDirective` (Tasks 2, 7). ✓
- Rejected → courteous email → `rulingEmail` (Task 2, 7). ✓
- Conservative regrade (no backward move when moved on) → `amendQuiz` stale guard + `applyRuling` still logs (Tasks 1, 2). ✓
- Error handling: duplicate (Tasks 4/5), stale (Task 1), API/429 failure → workflow `report-failure` + dispute stays `open` (Tasks 7/8), bad payload (Task 5), unknown id (Tasks 6/7). ✓
- Testing matrix → Tasks 1–6 carry the unit tests named in the spec. ✓

**Placeholder scan:** none — every code step shows complete code; the only non-unit-tested file (`adjudicate-dispute.mjs`) has an explicit `node --check` + manual E2E step.

**Type consistency:** `amendQuiz(curriculum, { module, attempt, creditConcept })` — defined Task 1, called by `applyRuling` Task 2. `applyRuling(curriculum, dispute, ruling, at)` with `dispute.questionIndex` + `dispute.payload` — produced Task 2, called Task 7 with `shaped = { module, attempt, questionIndex: dispute.question_index, payload }`. `createDispute → { id, duplicate }` — Task 4, consumed Task 5. `getDispute` row uses `course_id`/`question_index` (snake, DB columns) — Task 4, mapped to camel in Task 7's `shaped`. Ruling shape `{ verdict, upheld, reasoning, correctedQuestion }` consistent across Tasks 2, 6, 7. Consistent. ✓
