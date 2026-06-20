# curriculum.json — the single source of truth

The skill writes this file; the runtime scripts read and update it. One file holds
the plan and the progress, so the unattended job always knows what to send next.

## Fields

| Field | Meaning |
|-------|---------|
| `version` | Schema version. Currently `1`. |
| `subject` | The free-text subject the learner gave. |
| `angle` | The specific angle/goal, pinned down in the interview. |
| `level` | Self-rated level, 1 (novice) – 10 (expert). Shapes depth and vocabulary. |
| `settings.language` | Display name of the course language, e.g. `"Hebrew"`. Everything the learner reads is generated in this language. |
| `settings.languageCode` | BCP-47 code, e.g. `"he"`, `"es"`. Used for the page's `lang` attribute and to pick text direction. |
| `settings.chunkMinutes` | Target lesson length: `5`, `10`, or `30`. |
| `settings.cadence` | `daily` or `weekly`. |
| `settings.deliveryTime` | Local send time, `"HH:MM"` 24h. |
| `settings.timezone` | IANA timezone, e.g. `"Asia/Jerusalem"`. Used to convert the send time to the UTC cron. |
| `settings.workweekDays` | Days lessons may go out. `0`=Sunday … `6`=Saturday. Israel workweek = `[0,1,2,3,4]` (Sun–Thu). For `weekly` cadence, the first listed day is the send day. |
| `settings.email` | Where lessons are sent (also the From address). |
| `settings.model` | Claude model used to write lessons. Default `claude-sonnet-4-6`. |
| `settings.passThreshold` | Fraction of quiz correct needed to advance. Default `0.7`. |
| `researchContext` | One-paragraph grounding summary from onboarding web research. |
| `outline` | Ordered modules: `{ id, title, summary }`. The spine of the course. |
| `progress.currentModule` | `id` of the module to teach next. |
| `progress.attempt` | Times we've tried the current module. `1` = first try; `>1` = re-teach with different material after a failed quiz. |
| `progress.delivered` | History: `{ module, attempt, lessonFile, sentAt }` per send. |
| `progress.lastQuiz` | Most recent result that came back: `{ module, attempt, score, total, passed, at }`. |

## Language

Every learner-facing string is generated in `settings.language`: the lesson title and
body, the key-idea callout, the quiz questions and answer options, and the lesson page's
UI labels (e.g. the Submit button). The page sets `lang="<languageCode>"`. For right-to-left
languages (`he`, `ar`, `fa`, `ur`) the page sets `dir="rtl"`; otherwise `dir="ltr"`. Media
links found by web search may point to sources in another language — prefer sources in the
learner's language when available, fall back otherwise.

## State machine

**On each cadence (generate + send):**
1. Target = `progress.currentModule` at `progress.attempt`.
2. Generate the lesson. If `attempt > 1`, the generator must use a **different
   explanation / different examples / different media** than earlier attempts —
   that is the "repeat with other material" fallback.
3. Append a `delivered` record. Email the HTML file.

**When a quiz result comes back (record):**
- `passed = score / total >= settings.passThreshold`.
- **Passed:** `currentModule += 1`, `attempt = 1`. If past the last module, the
  course is complete (the cadence job sends a wrap-up and stops scheduling new work).
- **Not passed:** `attempt += 1`. Same module is re-taught differently next cadence.
- Always update `lastQuiz`.

The quiz result is trusted only with the module + attempt it was issued for, so a
stale or replayed result can't skip ahead.
