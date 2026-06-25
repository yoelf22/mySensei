# Course Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the learner's domain at onboarding; show prerequisites + a course-level label on the syllabus; make approval a real gate; and let the learner shift the level up/down (rebuild + re-approve) before lessons begin.

**Architecture:** A pure `lib/calibration.mjs` holds the closed domain list and the level-band mapping. The onboarding form captures `domain`; `build-curriculum` feeds it into the prompts and emits `prerequisites` + a derived `level` label, sets status `awaiting-approval` (no lesson yet). The syllabus page shows them and offers Approve / More advanced / More introductory. Adjust re-runs `build-curriculum` with `LEVEL_ADJUST` (one band shift) and re-emails the syllabus; Approve flips to `active`, generates lesson 1, and sends it.

**Tech Stack:** Node ESM (`lib/`, `scripts/`, `node:test`); Cloudflare Worker (`worker/src/`, vitest + `cloudflare:test`); GitHub Actions; Anthropic SDK (`claude-sonnet-4-6`).

## Global Constraints

- **Test runners:** `lib/*.test.mjs` and script checks via `npm test` / `node --test <file>`; worker tests via `cd worker && npm test`. Root `npm test` also collects `worker/test/*` which can't load under node:test (~pre-existing ERR_UNSUPPORTED_ESM_URL_SCHEME) — run focused `node --test lib/<file>` for lib signal.
- **Closed domain list** (`settings.domain` slug): `social-sciences`, `exact-sciences`, `engineering`, `arts-humanities`, `business-professional`, `health-medicine`, `other`.
- **Level bands** (ordered, representative level): General audience (1–2 / 2), Undergraduate (intro) (3–4 / 4), Undergraduate (advanced) (5–6 / 6), Graduate (7–8 / 8), Expert / research (9–10 / 10). The level label is **derived** from the numeric level, never Claude-chosen.
- **Approval is a gate:** `build-curriculum` sets `awaiting-approval` and generates NO lesson; approve → `active` + generate + send lesson 1; adjust → rebuild syllabus at a one-band-shifted level, stay `awaiting-approval`, re-email.
- **Model** via `lib/claude.mjs` (`claude-sonnet-4-6`); never hardcode another id.
- **Commits:** small, one per task, on a feature branch off `main`. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/calibration.mjs` | domains + level bands + helpers (pure) | **Create** |
| `lib/calibration.test.mjs` | calibration tests | **Create** |
| `lib/render-onboard.mjs` | Domain `<select>` + payload | **Modify** |
| `lib/render-onboard.test.mjs` | domain field test | **Modify** |
| `worker/src/dispatch.mjs` | onboard `domain`; `adjust` branch | **Modify** |
| `worker/test/callbacks.test.mjs` | dispatch tests | **Modify** |
| `scripts/build-curriculum.mjs` | domain prompts, prerequisites, level label, gate, adjust mode | **Modify** |
| `scripts/approve-syllabus.mjs` | flip awaiting-approval → active | **Create** |
| `package.json` | `"approve"` script | **Modify** |
| `lib/render-syllabus.mjs` | level badge + prerequisites + 3 buttons | **Modify** |
| `lib/render-syllabus.test.mjs` | syllabus calibration test | **Modify** |
| `.github/workflows/build-curriculum.yml` | drop the lesson-1 step | **Modify** |
| `.github/workflows/start-lessons.yml` | approve → activate + generate + send | **Modify** |
| `.github/workflows/syllabus-adjust.yml` | adjust rebuild + re-email | **Create** |

---

## Task 1: `lib/calibration.mjs` — domains + level bands

**Files:**
- Create: `lib/calibration.mjs`, `lib/calibration.test.mjs`

**Interfaces:**
- Produces: `DOMAINS` (`[{slug,label}]`), `LEVEL_BANDS` (`[{label,min,max,level}]`), `levelBandIndex(level)=>0..4`, `levelBandLabel(level)=>string`, `adjustLevel(level, direction)=>number` (one band shift, clamped), `domainLabel(slug)=>string` (falls back to "Other").

- [ ] **Step 1: Write the failing tests**

Create `lib/calibration.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { levelBandLabel, adjustLevel, domainLabel, DOMAINS } from "./calibration.mjs";

test("levelBandLabel maps levels to band labels and clamps", () => {
  assert.equal(levelBandLabel(1), "General audience");
  assert.equal(levelBandLabel(4), "Undergraduate (intro)");
  assert.equal(levelBandLabel(6), "Undergraduate (advanced)");
  assert.equal(levelBandLabel(8), "Graduate");
  assert.equal(levelBandLabel(10), "Expert / research");
  assert.equal(levelBandLabel(0), "General audience");
  assert.equal(levelBandLabel(99), "Expert / research");
});

test("adjustLevel moves one band and clamps at both ends", () => {
  assert.equal(adjustLevel(5, "up"), 8);    // band 2 → band 3
  assert.equal(adjustLevel(5, "down"), 4);  // band 2 → band 1
  assert.equal(adjustLevel(2, "down"), 2);  // already lowest
  assert.equal(adjustLevel(10, "up"), 10);  // already highest
  assert.equal(levelBandLabel(adjustLevel(6, "up")), "Graduate");
});

test("domainLabel resolves a known slug and falls back to Other", () => {
  assert.equal(domainLabel("engineering"), DOMAINS.find((d) => d.slug === "engineering").label);
  assert.equal(domainLabel("nonsense"), "Other");
  assert.equal(domainLabel(undefined), "Other");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test lib/calibration.test.mjs`
Expected: FAIL — cannot find `./calibration.mjs`.

- [ ] **Step 3: Implement**

Create `lib/calibration.mjs`:

```javascript
// Closed lists + level-band helpers for course calibration. Pure, no I/O.

export const DOMAINS = [
  { slug: "social-sciences", label: "Social sciences" },
  { slug: "exact-sciences", label: "Exact & natural sciences (math, physics, chemistry, biology)" },
  { slug: "engineering", label: "Engineering & technology (incl. computer science)" },
  { slug: "arts-humanities", label: "Arts & humanities" },
  { slug: "business-professional", label: "Business & professional" },
  { slug: "health-medicine", label: "Health & medicine" },
  { slug: "other", label: "Other" },
];

export const LEVEL_BANDS = [
  { label: "General audience", min: 1, max: 2, level: 2 },
  { label: "Undergraduate (intro)", min: 3, max: 4, level: 4 },
  { label: "Undergraduate (advanced)", min: 5, max: 6, level: 6 },
  { label: "Graduate", min: 7, max: 8, level: 8 },
  { label: "Expert / research", min: 9, max: 10, level: 10 },
];

function clampLevel(n) { return Math.max(1, Math.min(10, Math.round(Number(n) || 1))); }

export function levelBandIndex(level) {
  const L = clampLevel(level);
  const i = LEVEL_BANDS.findIndex((b) => L >= b.min && L <= b.max);
  return i < 0 ? 0 : i;
}

export function levelBandLabel(level) {
  return LEVEL_BANDS[levelBandIndex(level)].label;
}

export function adjustLevel(level, direction) {
  const step = direction === "up" ? 1 : direction === "down" ? -1 : 0;
  const j = Math.max(0, Math.min(LEVEL_BANDS.length - 1, levelBandIndex(level) + step));
  return LEVEL_BANDS[j].level;
}

export function domainLabel(slug) {
  const d = DOMAINS.find((x) => x.slug === slug);
  return (d || DOMAINS.find((x) => x.slug === "other")).label;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test lib/calibration.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/calibration.mjs lib/calibration.test.mjs
git commit -m "feat: lib/calibration — domains + level bands + adjust helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Onboarding Domain field

**Files:**
- Modify: `lib/render-onboard.mjs`
- Test: `lib/render-onboard.test.mjs`

**Interfaces:**
- Consumes: `DOMAINS` (Task 1); `escapeHtml` (already imported in render-onboard).
- Produces: the onboarding form has a required Domain `<select name="domain">` (from `DOMAINS`); the submit JS payload includes `domain` (the selected slug, default `"other"`).

- [ ] **Step 1: Write the failing test**

Append to `lib/render-onboard.test.mjs`:

```javascript
test("renderOnboardHtml has a domain select and sends domain in the payload", () => {
  const html = renderOnboardHtml({ webhookUrl: "https://app/submit", courseId: "c1" });
  assert.match(html, /name="domain"/);
  assert.match(html, /value="engineering"/);
  assert.match(html, /value="arts-humanities"/);
  assert.match(html, /domain:\s*d\.get\("domain"\)/); // payload carries it
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/render-onboard.test.mjs`
Expected: FAIL — no `name="domain"`.

- [ ] **Step 3: Implement**

In `lib/render-onboard.mjs`, add the import near the top (next to the `escapeHtml` import):

```javascript
import { DOMAINS } from "./calibration.mjs";
```

Inside `renderOnboardHtml`, before building the returned template, compute the options (place it near the other top-of-function `const`s like `hook`):

```javascript
  const domainOptions = DOMAINS.map((dm) => `<option value="${escapeHtml(dm.slug)}">${escapeHtml(dm.label)}</option>`).join("");
```

In the form HTML, add a Domain field immediately AFTER the education-level `</select>` (the `<select name="educationLevel">…</select>` block):

```html
    <label>Your field / background <span class="hint">(helps set prerequisites and examples)</span></label>
    <select name="domain">${domainOptions}</select>
```

In the submit `payload` object, add `domain` right after the `educationLevel` line:

```javascript
      educationLevel: d.get("educationLevel") || "undergraduate",
      domain: d.get("domain") || "other",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/render-onboard.test.mjs`
Expected: PASS (new test + existing render-onboard tests).

- [ ] **Step 5: Commit**

```bash
git add lib/render-onboard.mjs lib/render-onboard.test.mjs
git commit -m "feat: onboarding captures the learner's domain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dispatch — domain in settings + `adjust` branch

**Files:**
- Modify: `worker/src/dispatch.mjs`
- Test: `worker/test/callbacks.test.mjs`

**Interfaces:**
- Consumes: `buildDispatch(body)` (existing).
- Produces: the `onboard` dispatch's nested `settings` includes `domain` (`body.domain || "other"`); a new `adjust` type → `{ event_type: "syllabus-adjust", client_payload: { courseId, direction } }` where `direction` is validated to `"up"`/`"down"` (else `{ error: "invalid direction" }`).

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/callbacks.test.mjs` (it already imports `buildDispatch` from `../src/dispatch.mjs`; if not, add that import):

```javascript
import { buildDispatch as bd2 } from "../src/dispatch.mjs";

describe("calibration dispatch", () => {
  it("onboard carries the domain in settings", () => {
    const d = bd2({ type: "onboard", courseId: "c1", subject: "Chess", domain: "arts-humanities" });
    expect(d.client_payload.settings.domain).toBe("arts-humanities");
  });
  it("onboard defaults domain to other", () => {
    const d = bd2({ type: "onboard", courseId: "c1", subject: "Chess" });
    expect(d.client_payload.settings.domain).toBe("other");
  });
  it("adjust validates direction and maps to syllabus-adjust", () => {
    const up = bd2({ type: "adjust", courseId: "c1", direction: "up" });
    expect(up.event_type).toBe("syllabus-adjust");
    expect(up.client_payload).toEqual({ courseId: "c1", direction: "up" });
    expect(bd2({ type: "adjust", courseId: "c1", direction: "sideways" }).error).toBeTruthy();
  });
});
```

(`describe`/`it`/`expect` are already in scope in this vitest file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `worker/`): `npm test`
Expected: FAIL — `settings.domain` undefined; `adjust` returns `{ error: "unknown type" }` or falls through.

- [ ] **Step 3: Implement**

In `worker/src/dispatch.mjs`, in the `onboard` branch's nested `settings`, add `domain` (right after `educationLevel`):

```javascript
educationLevel: body.educationLevel || "undergraduate", domain: body.domain || "other", chunkMinutes: Number(body.chunkMinutes) || 10,
```

Add the `adjust` branch right after the `approve` branch:

```javascript
  if (type === "adjust") {
    const direction = body.direction === "up" ? "up" : body.direction === "down" ? "down" : "";
    if (!direction) return { error: "invalid direction" };
    return { event_type: "syllabus-adjust", client_payload: { courseId, direction } };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `worker/`): `npm test`
Expected: PASS (new calibration-dispatch tests + full worker suite).

- [ ] **Step 5: Commit**

```bash
git add worker/src/dispatch.mjs worker/test/callbacks.test.mjs
git commit -m "feat: dispatch carries domain + a validated syllabus-adjust

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Build-curriculum — domain, prerequisites, level label, gate, adjust mode

**Files:**
- Modify: `scripts/build-curriculum.mjs`

**Interfaces:**
- Consumes: `adjustLevel`, `levelBandLabel`, `domainLabel` (Task 1); `settings.domain` (Task 2/3).
- Produces: a curriculum whose `syllabus` has `prerequisites: string[]` and `level: <band label>`; `progress.status = "awaiting-approval"`; an **adjust mode** (env `LEVEL_ADJUST = up|down`) that skips judging and shifts the level one band.

(No unit test — this script does live Claude + Worker I/O; it's verified by `node --check` plus the calibration unit tests it relies on, and a hand-read at review.)

- [ ] **Step 1: Add the calibration import**

In `scripts/build-curriculum.mjs`, add to the imports:

```javascript
import { adjustLevel, levelBandLabel, domainLabel } from "../lib/calibration.mjs";
```

- [ ] **Step 2: Replace the level/outline/syllabus/save region**

Replace everything in `main()` from `const curriculum = await fetchCourse(COURSE_ID);` through the final `console.log(...)` line with:

```javascript
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
```

- [ ] **Step 3: Verify it parses**

Run: `node --check scripts/build-curriculum.mjs`
Expected: exit 0 (no syntax error).

- [ ] **Step 4: Confirm the calibration tests still pass (the helpers this uses)**

Run: `node --test lib/calibration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-curriculum.mjs
git commit -m "feat: build-curriculum — domain-calibrated prerequisites + level label; awaiting-approval gate; adjust mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `approve-syllabus.mjs` — flip awaiting-approval → active

**Files:**
- Create: `scripts/approve-syllabus.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `fetchCourse`, `saveCourse` from `scripts/lib/course-store.mjs`.
- Produces: a script that sets `progress.status` from `awaiting-approval` to `active` (idempotent no-op otherwise); `npm run approve`.

- [ ] **Step 1: Create the script**

Create `scripts/approve-syllabus.mjs`:

```javascript
// Flip a course from awaiting-approval to active when the learner approves the
// syllabus. Run by the start-lessons workflow before generating lesson 1.
// Env: COURSE_ID, APP_BASE_URL, INTERNAL_TOKEN.

import { fetchCourse, saveCourse } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

(async () => {
  const curriculum = await fetchCourse(COURSE_ID);
  const status = curriculum.progress && curriculum.progress.status;
  if (status !== "awaiting-approval") {
    console.log(`Course ${COURSE_ID} is not awaiting approval (status ${status}) — nothing to do.`);
    return;
  }
  curriculum.progress.status = "active";
  await saveCourse(COURSE_ID, curriculum);
  console.log(`Approved course ${COURSE_ID}: now active.`);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (after `"generate"`):

```json
    "approve": "node scripts/approve-syllabus.mjs",
```

- [ ] **Step 3: Verify it parses**

Run: `node --check scripts/approve-syllabus.mjs`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/approve-syllabus.mjs package.json
git commit -m "feat: approve-syllabus flips awaiting-approval to active

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Syllabus page — level badge, prerequisites, adjust buttons

**Files:**
- Modify: `lib/render-syllabus.mjs`
- Test: `lib/render-syllabus.test.mjs`

**Interfaces:**
- Consumes: `curriculum.syllabus.level` + `curriculum.syllabus.prerequisites` (Task 4).
- Produces: the syllabus renders a Course-level badge and a Prerequisites list, and three actions — Approve (`{type:"approve"}`), More advanced (`{type:"adjust",direction:"up"}`), More introductory (`{type:"adjust",direction:"down"}`). New `en`+`he` labels.

- [ ] **Step 1: Write the failing test**

Append to `lib/render-syllabus.test.mjs` (it already imports `renderSyllabusHtml`; reuse/extend a `curriculum` fixture — include `syllabus.level` + `syllabus.prerequisites`):

```javascript
test("syllabus shows the level badge, prerequisites, and three adjust actions", () => {
  const html = renderSyllabusHtml({
    curriculum: {
      subject: "Quantum computing", angle: "",
      level: 8, startLevel: 8,
      settings: { languageCode: "en", language: "English", cadence: "daily", deliveryTime: "07:00", timezone: "UTC" },
      outline: [{ id: 1, title: "Qubits", summary: "x", targetLevel: 8 }],
      syllabus: { title: "QC", subtitle: "t", introduction: "i", level: "Graduate", prerequisites: ["Linear algebra — undergraduate math", "Complex numbers"], bibliography: [] },
    },
    webhookUrl: "https://app/submit", courseId: "c1",
  });
  assert.match(html, /Graduate/);                       // level badge value
  assert.match(html, /Linear algebra/);                  // a prerequisite
  assert.match(html, /type:"adjust"[^}]*direction:"up"/);   // more advanced
  assert.match(html, /direction:"down"/);                // more introductory
  assert.match(html, /type:"approve"/);                  // approve still there
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/render-syllabus.test.mjs`
Expected: FAIL — no badge / prerequisites / adjust buttons.

- [ ] **Step 3: Add labels**

In `lib/render-syllabus.mjs`, extend BOTH label tables (`en` and `he`) with:

```javascript
    courseLevel: "Course level",
    prerequisites: "Prerequisites",
    moreAdvanced: "Make it more advanced",
    moreIntroductory: "Make it more introductory",
    adjusting: "Re-pitching your course — we'll email you the updated syllabus shortly.",
```

(he values:)

```javascript
    courseLevel: "רמת הקורס",
    prerequisites: "דרישות קדם",
    moreAdvanced: "העלו את הרמה",
    moreIntroductory: "הורידו את הרמה",
    adjusting: "מתאימים מחדש את הרמה — נשלח לכם את התכנית המעודכנת במייל בקרוב.",
```

- [ ] **Step 4: Render the badge + prerequisites**

In `renderSyllabusHtml`, after the existing `const items = …` block, add:

```javascript
  const levelBadge = fm.level ? `<p class="path">${escapeHtml(L.courseLevel)}: ${escapeHtml(fm.level)}</p>` : "";
  const prereqs = Array.isArray(fm.prerequisites) ? fm.prerequisites : [];
  const prereqHtml = prereqs.length
    ? `<h2>${escapeHtml(L.prerequisites)}</h2><ul>${prereqs.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
    : "";
```

In the `<main>` body, add `${levelBadge}` right after the existing `<p class="path">…</p>` line, and add `${prereqHtml}` right before the `<h2>${escapeHtml(L.contents)}</h2>` line.

- [ ] **Step 5: Replace the approve form + script**

Replace the approve form line:

```javascript
  ${webhookUrl ? `<form id="ap"><button type="submit">${escapeHtml(L.approve)}</button><p id="apdone" role="status"></p></form>` : ""}
```

with:

```javascript
  ${webhookUrl ? `<form id="ap"><button type="submit" id="apbtn">${escapeHtml(L.approve)}</button> <button type="button" id="upbtn">${escapeHtml(L.moreAdvanced)}</button> <button type="button" id="downbtn">${escapeHtml(L.moreIntroductory)}</button><p id="apdone" role="status"></p></form>` : ""}
```

Replace the inline `<script>` block (the one with `f.addEventListener("submit", …)`) with:

```javascript
${webhookUrl ? `<script>
  var L = ${JSON.stringify({ starting: L.starting, approveErr: L.approveErr, adjusting: L.adjusting })};
  var HOOK = ${JSON.stringify(webhookUrl)};
  var CID = ${JSON.stringify(courseId || "")};
  var f = document.getElementById("ap"), o = document.getElementById("apdone");
  function send(body, msg){
    o.className = ""; o.textContent = msg;
    var btns = f.querySelectorAll("button"); for (var i=0;i<btns.length;i++) btns[i].disabled = true;
    fetch(HOOK, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) })
      .then(function(r){ if(!r.ok) throw new Error(); })
      .catch(function(){ o.className="err"; o.textContent = L.approveErr; for (var i=0;i<btns.length;i++) btns[i].disabled = false; });
  }
  f.addEventListener("submit", function(e){ e.preventDefault(); send({ type:"approve", courseId:CID }, L.starting); });
  document.getElementById("upbtn").addEventListener("click", function(){ send({ type:"adjust", courseId:CID, direction:"up" }, L.adjusting); });
  document.getElementById("downbtn").addEventListener("click", function(){ send({ type:"adjust", courseId:CID, direction:"down" }, L.adjusting); });
</script>` : ""}
```

(Note: this replaces the previous `var HOOK` usage — confirm `HOOK` is now defined inside this script and the old `(function(){…})()` wrapper/`HOOK` reference is fully replaced.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test lib/render-syllabus.test.mjs`
Expected: PASS (new test + existing syllabus tests).

- [ ] **Step 7: Commit**

```bash
git add lib/render-syllabus.mjs lib/render-syllabus.test.mjs
git commit -m "feat: syllabus shows level + prerequisites and offers level adjust

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Workflows — gate the lesson, wire approve + adjust

**Files:**
- Modify: `.github/workflows/build-curriculum.yml`
- Modify: `.github/workflows/start-lessons.yml`
- Create: `.github/workflows/syllabus-adjust.yml`

**Interfaces:**
- Consumes: `npm run approve` (Task 5), `npm run generate`/`npm run send`, `scripts/build-curriculum.mjs` (Task 4, `LEVEL_ADJUST`), `scripts/send-syllabus.mjs`.

- [ ] **Step 1: Drop the lesson-1 step from build-curriculum.yml**

In `.github/workflows/build-curriculum.yml`, **delete the entire "Generate first lesson" step** (the step named `Generate first lesson` running `npm run generate` with `MYSENSEI_FORCE: "1"`). Keep the "Judge level + build curriculum" step, the "Email the syllabus" step, and the failure step.

- [ ] **Step 2: Make start-lessons activate + generate + send**

Replace the single "Email the first lesson" step in `.github/workflows/start-lessons.yml` with three steps (same `env` style as the other workflows):

```yaml
      - name: Approve the syllabus (awaiting-approval -> active)
        env:
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
        run: npm run --silent approve

      - name: Generate the first lesson
        env:
          MYSENSEI_FORCE: "1"
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
        run: npm run --silent generate

      - name: Email the first lesson
        env:
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          MAIL_TO: ${{ vars.MAIL_TO }}
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
        run: npm run --silent send
```

(Keep the checkout/setup-node/npm-install steps above them unchanged.)

- [ ] **Step 3: Create the syllabus-adjust workflow**

Create `.github/workflows/syllabus-adjust.yml`:

```yaml
name: syllabus-adjust
on:
  repository_dispatch:
    types: [syllabus-adjust]
permissions:
  contents: read
concurrency:
  group: mysensei-build-${{ github.event.client_payload.courseId }}
  cancel-in-progress: false
jobs:
  adjust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install --no-audit --no-fund

      - name: Re-pitch the curriculum one band
        env:
          LEVEL_ADJUST: ${{ github.event.client_payload.direction }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
        run: node scripts/build-curriculum.mjs

      - name: Email the updated syllabus
        env:
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
          MAIL_TO: ${{ vars.MAIL_TO }}
          COURSE_ID: ${{ github.event.client_payload.courseId }}
          APP_BASE_URL: ${{ vars.APP_BASE_URL }}
          INTERNAL_TOKEN: ${{ secrets.INTERNAL_TOKEN }}
        run: node scripts/send-syllabus.mjs

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

- [ ] **Step 4: Validate the YAML**

Run: `python3 -c "import yaml; [yaml.safe_load(open(f)) for f in ['.github/workflows/build-curriculum.yml','.github/workflows/start-lessons.yml','.github/workflows/syllabus-adjust.yml']]; print('YAML OK')"`
Expected: `YAML OK`. (If `python3`/`yaml` is unavailable, eyeball indentation against the existing workflows and say so.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/build-curriculum.yml .github/workflows/start-lessons.yml .github/workflows/syllabus-adjust.yml
git commit -m "feat: gate lessons on approval; wire approve (activate+generate) and syllabus-adjust

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation (owner-operated)

Worker change (the `adjust` dispatch) needs a redeploy; the rest is scripts/workflows that run from `origin/main`, so push + deploy:

```bash
cd worker && npm run deploy   # picks up the dispatch.mjs adjust branch
```

No migration. Live check: onboard a course (now asks Domain) → placement → the syllabus email arrives with a **Course level** badge + **Prerequisites** and **no lesson yet**; "Make it more introductory" re-emails a re-pitched syllabus; "Approve & start" sends lesson 1.

---

## Self-Review

**Spec coverage** (against `2026-06-25-course-calibration-design.md`):
- Calibration helpers (DOMAINS, level bands, levelBandLabel, adjustLevel, domainLabel) → Task 1. ✓
- Onboarding Domain field → Task 2; carried in the dispatch settings → Task 3. ✓
- Domain into the build prompts; prerequisites + derived level label in syllabus → Task 4. ✓
- Adjust mode (LEVEL_ADJUST, one band, skip judging) → Task 4 + dispatch `adjust` (Task 3) + workflow (Task 7). ✓
- Approval gate: status `awaiting-approval`, no lesson at build; approve → activate + generate + send → Task 4 (status) + Task 5 (approve script) + Task 7 (workflows). ✓
- Syllabus shows level + prerequisites + three buttons → Task 6. ✓
- Error handling: missing domain → `other` (Task 1 fallback); adjust clamp at ends (Task 1); invalid direction → 400 (Task 3); approve no-op when not awaiting (Task 5). ✓
- Tests: calibration, onboarding payload, dispatch, syllabus render → Tasks 1/2/3/6; scripts via `node --check` → Tasks 4/5; workflows via YAML validate → Task 7. ✓

**Placeholder scan:** none — every code step shows complete code; the two I/O scripts have `node --check` + explicit hand-read-at-review.

**Type consistency:** `domainLabel`/`levelBandLabel`/`adjustLevel` (Task 1) consumed by Task 4 and (`DOMAINS`) by Task 2. `settings.domain` produced in Task 2 (form) + Task 3 (dispatch), read in Task 4. `curriculum.syllabus.level`/`.prerequisites` produced in Task 4, rendered in Task 6. The `adjust` dispatch `{ direction }` (Task 3) → `LEVEL_ADJUST` env (Task 7) → `process.env.LEVEL_ADJUST` (Task 4). `npm run approve` (Task 5) → start-lessons step (Task 7). `awaiting-approval` status (Task 4) → `openHref` already maps it to `/c/:id/syllabus` (existing) and Task 5 flips it. Consistent. ✓
