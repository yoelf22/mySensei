// Triggered by the "dialogue" repository_dispatch. Generates ONE Socratic reply
// to the latest author message for STAGE, appends it, re-renders the page.
// Env: COURSE_ID, STAGE, ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, MODEL, textOf } from "../lib/claude.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
const STAGE = process.env.STAGE === "draft" ? "draft" : "plan";
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const proj = await fetchProject(COURSE_ID);
  const thread = STAGE === "plan" ? proj.planThread : proj.draftThread;
  const docType = STAGE === "plan" ? "plan" : "draft";
  const docText = proj.course[docType + "Doc"] || "";

  const convo = thread.map((m) => `${m.role === "user" ? "Author" : "You"}: ${m.content}`).join("\n");
  const c = client();
  const r = await c.messages.create({
    model: MODEL, max_tokens: 1024,
    messages: [{ role: "user", content:
      `You are a Socratic research mentor. Here is the current ${STAGE}:\n---\n${docText}\n---\n` +
      `Conversation so far:\n${convo}\n\n` +
      `Respond with ONE short, probing reply: challenge a weak assumption, expose a gap, or push the thesis to be sharper. ` +
      `Ask a question or make a pointed observation. Do not rewrite the ${STAGE}; that happens when the author hits Regenerate.` }],
  });
  await addArtifact(COURSE_ID, { stage: STAGE, type: "message", role: "mysensei", content: textOf(r).trim() });

  const fresh = await fetchProject(COURSE_ID);
  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: STAGE, status: fresh.course.status,
    document: docText, thread: STAGE === "plan" ? fresh.planThread : fresh.draftThread,
    languageCode: (fresh.course.settings || {}).languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Socratic reply added for ${COURSE_ID} (${STAGE}).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
