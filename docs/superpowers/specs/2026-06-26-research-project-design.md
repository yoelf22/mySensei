# Research Project Track — Design

Date: 2026-06-26
Status: Approved (brainstorming), pending implementation plan

## Problem

mySensei today builds **courses**: onboard → placement quiz → syllabus → lessons
dripped on a daily/weekly clock. We want a second, parallel type of interaction —
a **Research Project** — that takes a research question and walks it through a
plan, a full research paper, downloadable files, and finally a presentation. The
user picks Course or Research Project on the same onboarding form; everything
downstream branches on that choice.

## Decisions (settled during brainstorming)

- **One toggle, shared form.** Onboarding gets a Course / Research Project toggle.
  Picking Research Project reframes the copy ("What do you want to research?"),
  hides the scheduling fields, and keeps language / education level / field
  (these set the paper's register and depth).
- **No quiz for research.** A Research Project skips the placement quiz entirely.
  Depth comes from the education level / field inputs and from the building
  dialogue. (After onboarding, mySensei goes straight to generating the plan.)
- **Event-driven, no clock.** No "how often / delivery time / timezone" for
  research. Each step is produced as soon as it can be, and the moment the user
  confirms or responds, the next step starts. Email only **notifies** ("plan
  ready", "draft ready", "downloads ready") with a sign-in link to the page.
- **Building is a Socratic dialogue, not a one-shot feedback box.** While the
  plan and the draft are being shaped (before locking a version), the user and
  mySensei go back and forth in a **chat thread**: mySensei asks probing
  questions — challenging the thesis, testing assumptions, surfacing gaps — and
  the user steers.
- **Talk, then regenerate.** The dialogue is free-form; when the conversation has
  moved things forward, the user hits **Regenerate** and mySensei rewrites the
  whole plan/draft into a **new version** reflecting the discussion. Review,
  talk more, regenerate again — until the user **Locks** it. Clean version
  history; the live document is never patched mid-sentence.
- **Real sources only.** The paper is built section-by-section using the existing
  web-search tool; real source URLs/titles are captured as each section is
  written and the references section is assembled from them. Unsupported claims
  are flagged, never given an invented citation.
- **Paper downloads: PDF + .docx.** Both formats.
- **Presentation: .pptx + browser deck.** Generated on request after the paper is
  locked. Each slide = heading + main learning; the narrative lives in the
  presenter notes (native notes field in .pptx, speaker-notes view in the deck).
- **Reuse, don't duplicate.** A Research Project is stored as a course record
  marked `kind = "research"`, reusing the existing sign-in / email / page
  plumbing. One new append-only table holds the plan/draft versions and the
  dialogue turns. The course flow is untouched.
- **Model split.** Sonnet 4.6 for the frequent, cheap dialogue turns; Opus for
  the heavy generation (plan, paper sections, deck). Config switch, easy to
  change.

## Data model

Additive migration only — existing courses are untouched.

- `courses` gains **`kind TEXT NOT NULL DEFAULT 'course'`** (`'course'` |
  `'research'`). All existing rows default to `'course'`.
- New table **`research_artifacts`** — append-only, holds two row shapes
  distinguished by `type`:

```sql
CREATE TABLE research_artifacts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,        -- courses.id where kind='research'
  stage       TEXT NOT NULL,        -- 'plan' | 'draft' | 'final' | 'deck' (phase this row belongs to; separates the plan thread from the draft thread)
  type        TEXT NOT NULL,        -- 'plan' | 'draft' | 'final' | 'deck' | 'message'
  version     INTEGER,              -- for document rows (plan v1, v2, ...); null for messages
  role        TEXT,                 -- for message rows: 'mysensei' | 'user'; null for documents
  content     TEXT,                 -- document body (markdown) or message text
  citations   TEXT,                 -- JSON array of {title,url} for document rows; null otherwise
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_artifacts_project ON research_artifacts(project_id, created_at);
```

- **Document versions**: `type` in `plan|draft|final|deck`, with `version`,
  `content`, `citations`.
- **Dialogue turns**: `type='message'` with `role` and `content` (text), tied to
  `stage` so the plan thread and the draft thread are separable.
- The project's current step lives in the existing `courses.status`:
  `planning → plan-talk → drafting → draft-talk → finalizing → final-ready → deck-ready`.

## The pipeline (event-driven)

```
Onboard (kind=research)
  → research the question, generate PLAN v1  [Opus + web search]
  → email "plan ready"

PLAN stage  (status: plan-talk)
  Project page = chat thread + current plan
  user message → mySensei Socratic reply  [Sonnet]   (repeat)
  "Regenerate plan" → PLAN v(n+1) reflecting the thread  [Opus + web search]
  "Lock the plan" → status: drafting

DRAFT stage
  → generate DRAFT v1: full paper following the locked plan, section by section,
    capturing real citations  [Opus + web search]
  → email "draft ready"  (status: draft-talk)
  Same chat-then-regenerate loop on the draft  [Sonnet dialogue / Opus regen]
  "Lock the paper" → status: finalizing

FINALIZE
  → build PDF + .docx from the locked paper  [GitHub Action]
  → email "downloads ready"  (status: final-ready)
  Project page shows downloads + "Generate presentation"

DECK  (on request)
  → build .pptx + browser deck  [GitHub Action]
  → status: deck-ready; page shows deck downloads + "open browser deck"
```

Each generation step that needs heavy tooling or long compute runs as a
**GitHub Action background job** (repository_dispatch), exactly as lessons,
onboarding, and curriculum builds do today. The worker stays thin: it persists
artifacts, serves pages, and fires dispatches.

## Generation quality

- **Section-by-section paper build.** Following the locked plan's outline, each
  section (abstract, each body section, conclusion) is researched and written in
  its own pass so sections have room to be deep rather than one shallow
  single-shot generation.
- **Citation capture.** The web-search tool returns source metadata; the build
  captures real `{title, url}` per section into `citations`. The **references
  section is assembled from captured sources only.** A claim without a source is
  flagged for the user, never given a fabricated reference. (Note: `lib/claude.mjs`
  `research()` currently keeps only text blocks — the research-paper path needs a
  variant that also returns the web-search citation blocks.)
- **Register/depth** set by education level + field inputs and refined through the
  dialogue.

## File generation

The Cloudflare worker can't run document tooling, so files are produced in
GitHub Actions and the artifacts/pages store the results:

- **PDF** — reuse the project's existing markdown→PDF path.
- **.docx** — Word generator added to the finalize job.
- **.pptx** — slide generator: heading + key point per slide, narrative in the
  native presenter-notes field.
- **Browser deck** — self-contained HTML slideshow with a speaker-notes view,
  served as a page route like lessons.

Storage location for the binary files (PDF/.docx/.pptx) follows how pages are
stored today; the exact spot (worker storage vs. a served route) is settled in
the implementation plan.

## Pages / UI

- **Onboarding** — Course / Research Project toggle; research mode hides
  scheduling fields and reframes copy.
- **Project page** — current plan/draft rendered at top; Socratic chat thread
  below; message box; stage buttons (**Regenerate**, **Lock**). Reuses existing
  styling.
- **After lock-the-paper** — downloads panel (PDF, .docx) + "Generate
  presentation" button.
- **After deck** — .pptx download + "open browser deck."
- All reached the existing way: email link → sign in → page.

## Testing

- **Migration** additive only (`kind` column + `research_artifacts`); existing
  courses unaffected — verified by a migration test.
- **Unit tests** (existing `node --test` / vitest patterns): plan renderer,
  paper renderer, deck renderer; artifacts store (version ordering, dialogue
  ordering, stage separation); citation capture (real sources in, references
  out, unsupported-claim flagging); onboarding branch logic (research hides
  scheduling, skips quiz).
- **Course flow untouched** — research is a parallel branch gated by `kind`.

## Out of scope (YAGNI for v1)

- Collaboration / multiple authors on a project.
- Citation-style switching (APA/MLA/etc.) — pick one sensible default.
- Re-opening a locked paper for more edits after finalize (lock is final for v1;
  user can start a new project).
- A generalized "track engine" abstraction (rejected in favor of the `kind` flag).
