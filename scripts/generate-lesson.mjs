// Generate the next lesson and store it via the Worker API.
// Run by the cadence GitHub Action (gated by the learner's schedule) or
// manually with MYSENSEI_FORCE=1.
//
// Reads:  D1 course via Worker API (COURSE_ID, APP_BASE_URL, INTERNAL_TOKEN), env ANTHROPIC_API_KEY
// Writes: lesson page + updated course via Worker API

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { fetchCourse, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";
import { nextTarget, needsMoreModules, atMastery } from "../lib/progress.mjs";
import { shouldSendNow } from "../lib/schedule.mjs";
import { renderLessonHtml } from "../lib/render-lesson.mjs";

const MODEL = process.env.MYSENSEI_MODEL || "claude-sonnet-4-6";
const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function readCurriculum() {
  return await fetchCourse(COURSE_ID);
}
async function writeCurriculum(c) { await saveCourse(COURSE_ID, c); }
function textOf(message) {
  return (message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
function setOutput(kv) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }
}

// --- Claude calls -----------------------------------------------------------

// Web-search the module topic; return plain-text research notes incl. any real
// media URLs the model surfaced.
async function research(client, curriculum, module) {
  const s = curriculum.settings;
  const prompt =
    `I'm writing a ${s.chunkMinutes}-minute micro-lesson in ${s.language} about "${module.title}" ` +
    `within the subject "${curriculum.subject}". The learner's angle: ${curriculum.angle}. ` +
    `Their current level is ${curriculum.level}/10.\n\n` +
    `Search the web and give me: (1) a tight synthesis of what to teach for this module at this level, ` +
    `and (2) up to two REAL supporting media links you actually found — ideally one image URL and one short video or article URL, ` +
    `each on its own line prefixed with "IMAGE: " or "LINK: ". Prefer sources in ${s.language}. ` +
    `If you can't find solid media, say so and give none. Do not invent URLs.`;

  let messages = [{ role: "user", content: prompt }];
  let out = "";
  for (let i = 0; i < 5; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages,
    });
    out += "\n" + textOf(resp);
    if (resp.stop_reason !== "pause_turn") break;
    messages = [{ role: "user", content: prompt }, { role: "assistant", content: resp.content }];
  }
  return out.trim();
}

const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    intro: { type: "string" },
    keyIdea: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" } },
          bullets: { type: "array", items: { type: "string" } },
        },
        required: ["heading", "paragraphs", "bullets"],
      },
    },
    takeaways: { type: "array", items: { type: "string" } },
    media: {
      type: "object",
      additionalProperties: false,
      properties: {
        imageUrl: { type: "string" },
        imageAlt: { type: "string" },
        linkUrl: { type: "string" },
        linkLabel: { type: "string" },
      },
      required: ["imageUrl", "imageAlt", "linkUrl", "linkLabel"],
    },
    quiz: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          concept: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["question", "options", "correctIndex", "concept", "explanation"],
      },
    },
  },
  required: ["title", "intro", "keyIdea", "sections", "takeaways", "media", "quiz"],
};

async function authorLesson(client, curriculum, module, attempt, researchNotes) {
  const s = curriculum.settings;
  const retry = attempt > 1
    ? `This is attempt ${attempt}: the learner did NOT pass last time, so teach the SAME concept with DIFFERENT explanations, examples, and media than before.\n`
    : "";
  const missed = (curriculum.progress && curriculum.progress.lastQuiz && curriculum.progress.lastQuiz.missedConcepts) || [];
  const reinforce = missed.length
    ? `The learner recently got these points wrong — weave a brief reinforcement of them into this lesson where it fits naturally: ${missed.join("; ")}.\n`
    : "";
  const prompt =
    `Write a ${s.chunkMinutes}-minute micro-lesson entirely in ${s.language}.\n` +
    `Subject: ${curriculum.subject}\nModule: ${module.title} — ${module.summary || ""}\n` +
    `Angle: ${curriculum.angle}\nLearner level: ${curriculum.level}/10 (pitch the depth here).\n${retry}${reinforce}\n` +
    `Use these research notes for grounding and media:\n---\n${researchNotes}\n---\n\n` +
    `Rules: Everything (title, body, key idea, quiz questions and options) in ${s.language}. ` +
    `Keep it light and concrete. For media, ONLY use URLs that appear verbatim in the research notes; ` +
    `if a real image or link URL isn't present, set that field to an empty string. ` +
    `Write a 3–5 question multiple-choice quiz that genuinely checks understanding; each question 3–4 options; ` +
    `correctIndex is the 0-based index of the right option. For each question also include a short "concept" label ` +
    `(the idea it tests, in ${s.language}) and a one-sentence "explanation" of why the correct answer is right (in ${s.language}).`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: LESSON_SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });
  return JSON.parse(textOf(resp));
}

// Invent the next module when the learner has run past the planned outline.
async function extendOutline(client, curriculum) {
  const s = curriculum.settings;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      targetLevel: { type: "integer" },
    },
    required: ["title", "summary", "targetLevel"],
  };
  const covered = (curriculum.outline || []).map((m) => m.title).join("; ");
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{
      role: "user",
      content:
        `Subject: ${curriculum.subject}. Angle: ${curriculum.angle}. Language: ${s.language}. ` +
        `Learner is at level ${curriculum.level}/10. Already covered: ${covered}. ` +
        `Propose the NEXT single module that pushes toward mastery (level 10). ` +
        `targetLevel must be greater than ${curriculum.level} and at most 10. Title/summary in ${s.language}.`,
    }],
  });
  const mod = JSON.parse(textOf(resp));
  const maxId = Math.max(0, ...(curriculum.outline || []).map((m) => m.id));
  const withId = { id: maxId + 1, ...mod };
  curriculum.outline.push(withId);
  return withId;
}

// Mastery: a congratulations + specialization-prompt page (no quiz).
async function masteryPage(client, curriculum) {
  const s = curriculum.settings;
  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      title: { type: "string" },
      message: { type: "string" },
      specializations: { type: "array", items: { type: "string" } },
    },
    required: ["title", "message", "specializations"],
  };
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1200,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{
      role: "user",
      content:
        `The learner reached level 10 in "${curriculum.subject}" (angle: ${curriculum.angle}). ` +
        `Write, entirely in ${s.language}: a celebratory title, a short congratulations message, and 4 suggested ` +
        `specializations (deeper or adjacent niches) they could pursue next. Title/message/specializations all in ${s.language}.`,
    }],
  });
  const m = JSON.parse(textOf(resp));
  const lesson = {
    moduleId: curriculum.progress.currentModule, attempt: 1,
    title: m.title, intro: m.message, keyIdea: "",
    sections: [{
      heading: "→ /mySensei",
      paragraphs: [
        s.language.toLowerCase().startsWith("hebrew")
          ? "כדי להתחיל מסלול חדש, הריצו שוב את /mySensei ובחרו התמחות."
          : "To start a new track, run /mySensei again and pick a specialization.",
      ],
      bullets: m.specializations,
    }],
    takeaways: [], media: {}, quiz: [],
  };
  return lesson;
}

// --- main -------------------------------------------------------------------

async function main() {
  let curriculum;
  try { curriculum = await readCurriculum(); }
  catch (e) { console.log("No course to generate for:", e.message); setOutput({ sent: false, path: "" }); return; }

  const force = process.env.MYSENSEI_FORCE === "1";

  if (!force && !shouldSendNow(curriculum.settings, new Date())) {
    console.log("Not scheduled to send now — exiting.");
    setOutput({ sent: "false" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  const client = new Anthropic();

  let lesson, fileBase;

  if (atMastery(curriculum)) {
    lesson = await masteryPage(client, curriculum);
    fileBase = `mastery-${Date.now()}`;
  } else {
    let { module, moduleId, attempt } = nextTarget(curriculum);
    if (!module && needsMoreModules(curriculum)) {
      module = await extendOutline(client, curriculum);
      moduleId = module.id;
    }
    if (!module) {
      console.error(`No module ${moduleId} in outline and not in a state to extend.`);
      process.exit(1);
    }
    const notes = await research(client, curriculum, module);
    const content = await authorLesson(client, curriculum, module, attempt, notes);
    lesson = { ...content, moduleId, attempt };
    fileBase = `lesson-${String(moduleId).padStart(2, "0")}-attempt${attempt}`;
  }

  const html = renderLessonHtml({ curriculum, lesson, webhookUrl: submitUrl(), courseId: COURSE_ID });
  await savePage(COURSE_ID, fileBase, html);

  curriculum.progress.delivered = curriculum.progress.delivered || [];
  curriculum.progress.delivered.push({
    module: lesson.moduleId,
    attempt: lesson.attempt,
    lessonFile: fileBase,
    sentAt: new Date().toISOString(),
  });
  // Reinforcement consumed — clear the missed concepts so they're not re-taught forever.
  if (curriculum.progress.lastQuiz) curriculum.progress.lastQuiz.missedConcepts = [];
  await writeCurriculum(curriculum);

  setOutput({ sent: true, path: fileBase });
  console.log(fileBase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
