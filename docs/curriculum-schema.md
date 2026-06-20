# curriculum.json — the single source of truth

The skill writes this file; the runtime scripts read and update it. One file holds
the plan and the progress, so the unattended job always knows what to send next.

## Fields

| Field | Meaning |
|-------|---------|
| `version` | Schema version. Currently `1`. |
| `subject` | The free-text subject the learner gave. |
| `angle` | The specific angle/goal, pinned down in the interview. |
| `startLevel` | The learner's self-rating at the start of the current track, 1–10. Immutable for the track; resets when a new specialization track begins. |
| `level` | **Live** mastery, 1–10. Starts at `startLevel` and climbs as quizzes are passed. Reaching `10` ends the track and triggers specialization. |
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
| `outline` | Ordered modules: `{ id, title, summary, targetLevel }`. The spine of the track. `targetLevel` climbs from just above `startLevel` to `10` across the modules. |
| `progress.currentModule` | `id` of the module to teach next. |
| `progress.attempt` | Times we've tried the current module. `1` = first try; `>1` = re-teach with different material after a failed quiz. |
| `progress.status` | `active` (teaching), `awaiting-specialization` (hit level 10, waiting for the learner to pick a new niche). |
| `progress.delivered` | History: `{ module, attempt, lessonFile, sentAt }` per send. |
| `progress.lastQuiz` | Most recent result that came back: `{ module, attempt, score, total, passed, at }`. |
| `trackHistory` | Completed tracks, each `{ subject, angle, startLevel, finishedAt }`. Lets a new specialization build on what's already mastered. |

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
- **Passed:**
  - Raise mastery: `level = max(level, module.targetLevel)`.
  - `currentModule += 1`, `attempt = 1`.
  - If `currentModule` is past the last module **and `level < 10`**, the track isn't
    done — extend the outline with new, more advanced modules whose `targetLevel`s keep
    climbing toward 10, and continue.
  - If `level >= 10`, the track is **mastered** → set `status = "awaiting-specialization"`
    (see end-game below).
- **Not passed:** `attempt += 1`, `level` unchanged. Same module is re-taught with
  different material next cadence.
- Always update `lastQuiz`.

The quiz result is trusted only with the module + attempt it was issued for, so a
stale or replayed result can't skip ahead.

## End-game — reaching level 10

The course never just "ends." A track runs until the learner reaches **level 10** on its
angle. There is no fixed module count: while `level < 10` the outline keeps extending.

When `level` reaches 10:
1. `status` becomes `awaiting-specialization`. Normal lessons pause.
2. The next cadence run emails a **mastery message** instead of a lesson: congratulations,
   plus a prompt to choose a **specialization** — a deeper or adjacent niche within the
   subject. It offers a few AI-suggested specializations (generated from the subject and
   what they've covered) and a "something else" option.
3. The learner picks one. Two paths carry the choice back:
   - **Suggested option:** clicked in the email → the same quiz helper webhook fires a
     `specialize` event to GitHub.
   - **Free-text / their own idea:** they re-run `/mySensei` in Claude Code, which
     interviews the new angle richly.
4. mySensei then **generates a new sequence**: it pushes the finished track onto
   `trackHistory`, sets the new `angle`/specialization, picks a sensible `startLevel`
   (they carry parent-subject expertise but the niche has fresh depth), builds a new
   `outline` climbing that niche to 10, resets `level`/`progress`, and sets `status` back
   to `active`. Lessons resume on the same cadence.
