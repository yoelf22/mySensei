// Triggered by the "deck-due" repository_dispatch (Generate presentation).
// Builds a slide deck from the locked paper: a .pptx (stored in R2) and a
// browser deck page, sets status deck-ready, re-renders the project page.
// Env: COURSE_ID, ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { heavyClient, structured } from "../lib/claude.mjs";
import { DECK_SCHEMA, deckPrompt } from "../lib/deck-model.mjs";
import { deckToPptx } from "../lib/deck-pptx.mjs";
import { renderDeckHtml } from "../lib/render-deck.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, saveCourse, savePage, putFile, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const proj = await fetchProject(COURSE_ID);
  const settings = proj.course.settings || {};
  const paperText = proj.course.draftDoc || "";
  if (!paperText) { console.error("no paper to present (draftDoc missing)"); process.exit(1); }

  const deck = await structured(heavyClient(), deckPrompt({ paperText, settings }), DECK_SCHEMA, 6000);
  const slides = deck.slides || [];

  const pptx = await deckToPptx({ slides });
  await putFile(COURSE_ID, "pptx", pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation");

  const deckHtml = renderDeckHtml({ slides, courseId: COURSE_ID, languageCode: settings.languageCode || "en" });
  await savePage(COURSE_ID, "deck", deckHtml);

  const curriculum = { ...proj.course, kind: "research", progress: { ...(proj.course.progress || {}), status: "deck-ready" } };
  await saveCourse(COURSE_ID, curriculum);

  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: "draft", status: "deck-ready",
    document: paperText, thread: proj.draftThread || [],
    downloads: { pdf: `/c/${COURSE_ID}/download/pdf`, docx: `/c/${COURSE_ID}/download/docx` },
    deck: { pptx: `/c/${COURSE_ID}/download/pptx`, view: `/c/${COURSE_ID}/deck` },
    languageCode: settings.languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Deck generated for ${COURSE_ID}: ${slides.length} slides, .pptx stored, status deck-ready.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
