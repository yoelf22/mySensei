# Course Calibration — Design

Date: 2026-06-25
Status: Approved (brainstorming), pending implementation plan

## Problem

A course can land far above (or below) the learner's actual background. The
onboarding captures education level but not the learner's *field*, the syllabus
doesn't state what it assumes or how advanced it is, and the learner can only
approve as-is — they can't say "this is over my head." Add domain capture,
prerequisites + a course-level label on the syllabus, and let the learner nudge
the level up or down before approving.

## Decisions (settled during brainstorming)

- **Onboarding asks the learner's domain** (their background field), a closed
  list + "Other", alongside education level. Stored as `settings.domain`. It
  calibrates prerequisites and examples downstream.
- **The syllabus states prerequisites and a course-level label.** Prerequisites
  are honest about assumed background relative to the subject, the assigned
  level, and the learner's domain/education. The level label comes from a closed
  vocabulary mapped to bands of the internal 1–10 level.
- **Approval offers level adjustment.** Three actions: Approve & start / Make it
  more advanced / Make it more introductory. "More advanced/introductory" shifts
  the level **one band**, re-runs the curriculum build (new outline,
  prerequisites, level label), and shows the updated syllabus for approval
  again. The learner can keep nudging until it fits.
- **The level label is derived deterministically** from the numeric level (not
  Claude-chosen), so adjustment changes it predictably.

## Closed lists

**Domain** (`settings.domain` — the learner's background field):
`social-sciences`, `exact-sciences` (math/physics/chem/bio), `engineering`
(incl. CS), `arts-humanities`, `business-professional`, `health-medicine`,
`other`. (Stored as the slug; a human label shown in the form.)

**Level bands** — ordered, each with a representative numeric level used when
adjusting:
| Band index | Label | Level range | Representative level |
|---|---|---|---|
| 0 | General audience | 1–2 | 2 |
| 1 | Undergraduate (intro) | 3–4 | 4 |
| 2 | Undergraduate (advanced) | 5–6 | 6 |
| 3 | Graduate | 7–8 | 8 |
| 4 | Expert / research | 9–10 | 10 |

## Components

### 1. Calibration helpers — `lib/calibration.mjs` (new, pure)

- `DOMAINS` — array of `{ slug, label }` for the closed domain list (+ other).
- `LEVEL_BANDS` — the table above (`{ label, min, max, level }`, ordered).
- `levelBandIndex(level) => 0..4` — the band whose `[min,max]` contains the
  clamped level.
- `levelBandLabel(level) => string` — `LEVEL_BANDS[levelBandIndex(level)].label`.
- `adjustLevel(level, direction) => number` — `direction` is `"up"`/`"down"`;
  returns `LEVEL_BANDS[clamp(levelBandIndex(level) ± 1, 0, 4)].level` (moves
  exactly one band, clamped at the ends).
- `domainLabel(slug) => string` — the human label for a stored slug (falls back
  to "Other").

### 2. Onboarding — `lib/render-onboard.mjs`

- Add a required **Domain** `<select>` (from `DOMAINS`) next to the education
  level field. The submit payload gains `domain` (the slug).
- The worker `dispatch.mjs` `onboard` branch already nests course settings under
  one `settings` key (the 10-property cap workaround) — add `domain` there.
- `scripts/onboard.mjs` persists `settings.domain` with the rest of the
  settings (it stores the settings object wholesale; confirm `domain` rides
  along).

### 3. Curriculum build — `scripts/build-curriculum.mjs`

- **Domain into the prompts.** The outline, syllabus, and prerequisites prompts
  include the learner's domain (`domainLabel(settings.domain)`) and education
  level, so the pitch and the prerequisites are honest about gaps (e.g. a
  quantum course for an arts background flags the missing graduate math).
- **Syllabus front-matter gains `prerequisites`.** Extend the front-matter
  schema: `prerequisites` = an array of short strings (3–6 items), each a
  concrete assumed background ("Comfort with linear algebra and complex
  numbers — undergraduate math"). Generated relative to subject + level +
  domain.
- **Store the level label.** After setting `curriculum.level`, store
  `curriculum.syllabus.level = levelBandLabel(curriculum.level)` and
  `curriculum.syllabus.prerequisites = [...]`.
- **Adjust mode.** When run with a level-adjust direction (env
  `LEVEL_ADJUST = up | down`), skip the assessment-judging step and instead set
  `newLevel = adjustLevel(curriculum.level, direction)`; rebuild the outline +
  syllabus front-matter (prerequisites + label) at `newLevel`; set status back
  to `awaiting-approval`. The normal (assessment) path is unchanged when
  `LEVEL_ADJUST` is unset.

### 4. Syllabus page — `lib/render-syllabus.mjs`

- Display a **Course level** badge (`curriculum.syllabus.level`) and a
  **Prerequisites** list (`curriculum.syllabus.prerequisites`) above the
  contents.
- Replace the single approve button with three actions:
  - **Approve & start** → posts `{ type: "approve", courseId }` (unchanged).
  - **Make it more advanced** → posts `{ type: "adjust", courseId, direction: "up" }`.
  - **Make it more introductory** → posts `{ type: "adjust", courseId, direction: "down" }`.
- On an adjust click, show "Re-pitching your course at a more
  advanced/introductory level — we'll email you the updated syllabus shortly."
  New en + he labels for the level badge, prerequisites heading, the two adjust
  buttons, and the adjust confirmation.

### 5. Worker + workflow

- `dispatch.mjs`: add an `adjust` branch → `event_type: "syllabus-adjust"`,
  `client_payload: { courseId, direction }` (direction validated to up/down).
- A `syllabus-adjust` GitHub workflow runs `build-curriculum.mjs` with
  `LEVEL_ADJUST=<direction>` and `COURSE_ID`. On completion it re-sends the
  syllabus email (reuse `send-syllabus.mjs`) so the learner gets the updated
  link; status stays `awaiting-approval`.

### 6. Approval becomes a real gate (flow change)

Today `build-curriculum` sets `status="active"` and the workflow generates +
sends lesson 1 immediately, so the syllabus "approve" is cosmetic. To make
"calibrate before diving in" real:

- **`build-curriculum.mjs`** sets `progress.status = "awaiting-approval"` (not
  `active`), and the **`build-curriculum.yml` workflow drops the "Generate first
  lesson" step** — only the syllabus email goes out at build time. (The
  `syllabus-adjust` workflow likewise only rebuilds + re-emails the syllabus, no
  lesson.)
- **On approve** (`syllabus-approved` → `start-lessons.yml`): a small new
  `scripts/approve-syllabus.mjs` flips `awaiting-approval` → `active`; then the
  workflow generates lesson 1 (`npm run generate` with `MYSENSEI_FORCE=1`) and
  sends it (`npm run send`). So the first lesson is generated only after the
  learner approves the (possibly re-pitched) syllabus.
- Approving a course not in `awaiting-approval` is a no-op (idempotent).

## Data flow

1. Onboarding → `settings.domain` stored with the course.
2. Assessment → `build-curriculum` judges level, builds outline + syllabus with
   `prerequisites` + `level` label (calibrated by domain), status
   `awaiting-approval`, emails the syllabus link. **No lesson yet.**
3. Learner opens the syllabus → sees level + prerequisites → either **approves**
   (→ status `active`, lesson 1 generated + sent) or picks **more advanced /
   introductory**.
4. Adjust → `syllabus-adjust` workflow → `build-curriculum` rebuilds at the
   band-shifted level → re-sends the updated syllabus (still
   `awaiting-approval`) → back to step 3.

## Error handling

- **Missing `domain`** (old courses / a skipped field): treat as `other`;
  `domainLabel` falls back to "Other". The build still works.
- **Adjust at a band boundary:** `adjustLevel` clamps — "more advanced" at
  Expert (or "more introductory" at General audience) returns the same level;
  the rebuild is a harmless no-op re-pitch at the same band.
- **Invalid adjust direction:** the worker rejects anything but `up`/`down` (400).
- **Adjust on a course not awaiting approval:** the worker/workflow only acts on
  a course in `awaiting-approval`; otherwise it's ignored (logged).

## Testing

- **`lib/calibration.mjs`:** `levelBandLabel` at each band boundary;
  `adjustLevel` up/down moves one band and clamps at both ends; `domainLabel`
  known slug + `other` fallback.
- **`render-onboard`:** the form has the Domain select with the closed options;
  the payload includes `domain`.
- **`build-curriculum`** (pure pieces / structured-output shape): the syllabus
  schema requires `prerequisites`; the stored syllabus has `level` =
  `levelBandLabel(level)`; the adjust path computes `adjustLevel` and skips
  judging (test the level-selection branch with a mocked Claude client).
- **`render-syllabus`:** renders the level badge, the prerequisites list, and
  the three buttons with the correct `type`/`direction` payloads.
- **`dispatch.mjs`:** `adjust` → `syllabus-adjust` with a validated direction;
  bad direction → error.

## Out of scope / deferred

- Feeding `domain` into every daily lesson's register (the lesson generator
  already uses education level; domain calibration here lives in the syllabus +
  prerequisites). A later pass can thread domain into lesson generation.
- A live "rebuilding…" progress UI (the adjust uses the existing async
  email-when-ready pattern).
- Per-module prerequisites (prerequisites are course-level for v1).
