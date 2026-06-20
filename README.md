# mySensei

A personal tutor that drips browser-readable lessons to your inbox on a schedule.

You run it once in Claude Code (`/mySensei`), tell it a subject, and answer a short
interview. From then on a scheduled job writes the next lesson, adapts to how your
last quiz went, and emails you a single HTML file you open in any browser.

## How it works

**Setup (interactive, in Claude Code)**
1. You pick the language for your course, then give a subject in plain words.
2. It researches the subject on the web.
3. It interviews you (in your chosen language): the angle you care about, your level
   (1–10), and your settings (lesson length, daily/weekly, time, timezone, which days).
4. It writes this repo's `curriculum.json` and pushes to GitHub.

**Delivery (automatic, GitHub Actions — no Claude Code needed)**
5. On your cadence, an Action asks Claude to write the next lesson (adapting to your
   last quiz) and emails you a self-contained HTML file.
6. You open it, learn, and take the 3–5 question quiz at the bottom.
7. Your pass/fail goes through a tiny helper service back to GitHub, which records it
   and picks the next lesson: **pass → move on, fail → re-teach differently.**

## The lesson file

Each lesson is one light HTML file:
- Formatted text (headings, lists, a key-idea callout) lives in the file.
- Images load from the web via links; videos/articles are clickable links.
- A quiz at the bottom with a Submit button.

Media is found by a real web search at generation time, so links work and aren't
invented. If nothing solid is found, the lesson stays text-only.

The whole lesson — text, quiz, and page labels — is written in the language you chose,
and right-to-left languages (Hebrew, Arabic, …) render correctly.

## What you need (one-time)

- A GitHub repo on your account (free) — runs the schedule.
- An Anthropic API key — lets the cloud job call Claude to write lessons.
- A Gmail app password — lets the cloud job email you.
- A free Cloudflare account — hosts the ~20-line quiz helper.

`SETUP.md` walks through each one (created in milestone 2).

## Layout

```
.claude/skills/mySensei/SKILL.md   the /mySensei onboarding skill
curriculum.json                    your subject, settings, outline, progress
scripts/generate-lesson.mjs        asks Claude to write the next lesson (HTML + quiz)
scripts/send-email.mjs             emails the lesson via Gmail
worker/                            the tiny quiz helper (Cloudflare Worker)
.github/workflows/cadence.yml      scheduled: generate + email
.github/workflows/record-quiz.yml  quiz result comes back: record, advance or repeat
lessons/                           every generated lesson, kept for history
```

## Status

v1 in progress. Audio (listening to a lesson) is deferred to a later version.
