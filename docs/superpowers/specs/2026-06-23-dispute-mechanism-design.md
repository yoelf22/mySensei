# Dispute Mechanism — Design

Date: 2026-06-23
Status: Approved (brainstorming), pending implementation plan

## Problem

A lesson's quiz is graded in the browser against a stored correct-answer key. A
learner who believes a question marked them wrong unfairly — or who spots a
broken question (two correct options, a typo, an outdated fact, ambiguous
wording) — has no way to contest it. The verdict is final and silent.

We want a path for the learner to dispute a graded question and get a fair,
reasoned ruling, with their progress corrected when the dispute holds up.

## Scope

A learner can dispute **a graded quiz question** for two overlapping reasons,
handled by one flow:

1. **Contest a grade** — "my answer was right / the question was ambiguous."
2. **Flag a broken question** — "this question is wrong, regardless of my score."

Out of scope for v1: disputing an overall module pass/fail or a placement
level; human (owner) adjudication; live re-rendering of an already-delivered
lesson page; audio.

## Decisions (settled during brainstorming)

- **Adjudicator: Claude, automatically.** A dispute fires a workflow; Claude
  rules unattended. No human in the loop. The prompt is written to judge
  fairly rather than defend its own earlier question — default is *the original
  answer stands* unless the learner's case is genuinely sound, to avoid grade
  inflation.
- **Input: a short reason is required.** Clicking dispute opens a text box; the
  learner must say why before it sends. Gives Claude real grounds and
  discourages reflexive disputing.
- **Surface: every graded question** is disputable after submit, not only the
  ones marked wrong — quality flags are useful on questions the learner
  happened to answer "correctly" too.
- **Ruling delivery: by email**, not live on the page — adjudication runs in
  the background and isn't instant.
- **Upheld → two effects:** regrade the learner *and* fix the question (see
  below for what "fix" concretely means given lessons are ephemeral).
- **Transport: Worker stores the dispute, GitHub Action judges it** (chosen
  over stuffing the question into a `repository_dispatch` payload, which would
  blow the 10-property `client_payload` cap that already broke onboarding once;
  and over judging inside the Worker, which lacks the Anthropic key and the
  progress logic).

## Architecture

```
Lesson page (browser)
  │  POST { type:"dispute", courseId, module, attempt, questionIndex,
  │         question, options[], correctIndex, chosenIndex, explanation,
  │         concept, reason }
  ▼
Worker /submit  ──► stores row in `disputes` (D1)
  │                 refuses a duplicate (same course+module+attempt+question)
  │  repository_dispatch { event_type:"dispute", payload:{ courseId, disputeId } }
  ▼
GitHub Action  (.github/workflows/dispute.yml)
  └─ scripts/adjudicate-dispute.mjs
       ├─ fetch dispute row + course (Worker internal API)
       ├─ Claude rules (structured JSON verdict)
       ├─ if upheld: amend quiz result (progress.mjs) + log correction on course
       ├─ mark dispute resolved (status + ruling) in D1
       └─ email the learner the ruling (send-email.mjs)
```

## Components

### 1. Lesson page — `lib/render-lesson.mjs`

After grading, each `fieldset.q` gets a quiet "I think this is wrong" link.

- Clicking reveals an inline `<textarea>` ("What's wrong with this question?")
  plus a **Send** button. Empty text → no send (client-side required).
- On send, POST the dispute payload to the existing webhook (`meta.webhook`),
  tagged `type:"dispute"`. The payload is assembled from data already embedded
  in the page (`meta.correct[i]`, `meta.concepts[i]`, `meta.explanations[i]`,
  the question text and option labels from the DOM, the learner's `chosen`).
- On success, replace that question's dispute UI with a confirmation
  ("Thanks — we'll take another look and email you the verdict.") and prevent
  re-submission for that question.
- New label strings (en + he) for: dispute link, prompt, send, sent,
  empty-reason warning, offline.
- The dispute link only appears **after** the quiz is submitted/graded (it is
  attached in the same submit handler that renders per-question feedback).

### 2. Worker — `worker/src/`

- **New migration** `worker/migrations/0003_disputes.sql`: a `disputes` table —
  `id` (generated), `course_id`, `module`, `attempt`, `question_index`,
  `payload` (JSON: question, options, correctIndex, chosenIndex, explanation,
  concept, reason), `status` (`open` | `upheld` | `rejected`), `ruling` (JSON,
  nullable), `created_at`, `resolved_at` (nullable). Unique on
  `(course_id, module, attempt, question_index)` to enforce one dispute per
  question per attempt.
- **`/submit` handler** (`worker/src/worker.mjs` + helpers): add a `dispute`
  branch alongside the existing `quiz` / `onboard` / `assessment` routing.
  Validate, insert the row (reject duplicates with a friendly 200/409 the page
  can show), then `repository_dispatch` `event_type: "dispute"` with
  `client_payload: { courseId, disputeId }` (2 properties — well under the cap).
- **Internal API** (`worker/src/internal.mjs`): routes for the Action to
  `GET` a dispute by id and to `PUT` its resolution (status + ruling +
  resolved_at). Mirror the existing internal-token auth.

### 3. Adjudication — `scripts/adjudicate-dispute.mjs` (new)

Env: `DISPUTE_ID`, `COURSE_ID`, `APP_BASE_URL`, `INTERNAL_TOKEN`,
`ANTHROPIC_API_KEY`, mail vars.

1. Fetch the dispute row and the course.
2. Call Claude (`claude-sonnet-4-6`) with a structured-output schema:
   ```
   {
     verdict: "learner_correct" | "ambiguous" | "question_flawed" | "stands",
     upheld: boolean,            // true for the first three
     reasoning: string,          // learner-facing, teaches not just denies
     correctedQuestion?: {       // present when question_flawed/ambiguous
       question, options[], correctIndex, explanation
     }
   }
   ```
   Prompt framing: neutral third-party grader; given the question, options,
   marked-correct answer, the learner's pick, and their reason — would a fair
   grader accept the learner's answer or is the question genuinely flawed?
   **Default to `stands`** unless the case is sound.
3. **If upheld:**
   - **Regrade:** call a new `amendQuiz(curriculum, { module, attempt, creditQuestionConcept })`
     in `lib/progress.mjs` — credit the disputed question (+1 to the recorded
     score for that module+attempt), recompute pass/fail against the threshold.
     If it flips fail→pass **and the learner has not already moved past that
     module**, advance module/level exactly as a genuine pass would
     (reusing the existing advance logic). If they've already moved on, credit
     and log only — no retroactive level changes.
   - **Fix the question (log-and-feed-forward):** append the correction to a new
     `corrections` array on the course (module, original question, Claude's
     `correctedQuestion`, reason, date). This is surfaced to the learner in the
     ruling email and fed into the lesson generator's "avoid these pitfalls"
     context (see §4). No live page rewrite.
4. Save the amended course (if changed) and `PUT` the dispute resolution to the
   Worker.
5. **Email the learner** the ruling — upheld emails include the corrected
   question + right answer; rejected emails explain why the original stands.

### 4. Generator feed-forward — `scripts/generate-lesson.mjs`

When building the next lesson, if the course has `corrections` relevant to the
upcoming module(s), add a brief line to the generation prompt
("Past questions had these flaws; avoid repeating them: …"), alongside the
existing "missed concepts" reinforcement. Low-touch; keeps the same flaw from
recurring.

### 5. Progress — `lib/progress.mjs`

New `amendQuiz(curriculum, amendment)`:
- Find the recorded result for `(module, attempt)`. If none, return curriculum
  unchanged (stale/unknown — ignore, matching `recordQuiz`'s stale handling).
- Bump that result's score by 1 (cap at total). Recompute pass.
- If newly passing and the course's current position is still at/at-or-before
  that module's gate, advance via the existing progression rules; else leave
  position untouched and just persist the corrected score + a flag noting the
  amendment.
- Pure function, fully unit-tested (mirrors `recordQuiz` tests).

## Data flow summary

1. Learner submits quiz → result recorded as today (unchanged).
2. Learner disputes a question → Worker stores it, dispatches an id.
3. Action adjudicates → regrade + correction log (if upheld) → resolve →
   email learner.
4. Next lesson generation reads `corrections` and avoids the flaw.

## Error handling

- **Duplicate dispute:** unique constraint + friendly page message; no dispatch.
- **Stale dispute** (course moved on): regrade credits/logs but never moves the
  learner backward.
- **Claude/API failure** (incl. 429 daily-limit): the workflow logs the error
  via the existing `reportError` path; the dispute stays `open` and can be
  retried. The learner sees no false ruling.
- **Missing/invalid payload fields:** Worker validates and rejects before
  storing.
- **Unknown course/dispute id in the Action:** fail loudly, leave status `open`.

## Testing

- `lib/progress.mjs` — `amendQuiz` unit tests: credit within a fail, credit that
  flips fail→pass and advances, credit on an already-passed/moved-on module
  (no backward move), stale/unknown result ignored, score capped at total.
- `lib/render-lesson.mjs` — dispute link present per question after grade,
  payload shape, required-reason guard, single-submit per question.
- Worker — `disputes` migration applies; `/submit` dispute branch stores + 
  dispatches; duplicate rejected; internal get/resolve routes auth-gated.
- `adjudicate-dispute.mjs` — upheld and rejected paths with a mocked Claude
  client; correction logged; resolution PUT; learner email composed.

## Open questions / explicitly deferred

- Owner override / notification of rulings — deferred (v1 is fully automatic;
  rulings are logged on the course and can be reviewed later).
- Live re-render of the delivered page to show the corrected question —
  deferred (lessons are ephemeral; the corrected question reaches the learner by
  email instead).
- Rate-limiting beyond one-dispute-per-question — not needed for a
  single-learner course; revisit if multi-tenant volume grows.
