// Triggered by the "dialogue" repository_dispatch. Generates ONE Socratic reply
// to the latest author message for STAGE, appends it, re-renders the page.
// Env: COURSE_ID, STAGE, ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, MODEL, structured } from "../lib/claude.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, savePage, submitUrl } from "./lib/course-store.mjs";

// mySensei answers AND judges whether the work is solid enough to lock, so the
// Lock button stays disabled until the mentor has no substantive objection left.
const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "One short, probing Socratic reply: challenge a weak assumption, expose a gap, or push the thesis to be sharper. A question or pointed observation. Do not rewrite the document." },
    readyToLock: { type: "boolean", description: "Your judgment as a tough but fair critic: true ONLY when the thesis is clear, defensible, and well-scoped enough to start writing, with no substantive objection remaining; false if any weak assumption, gap, or vagueness is still unresolved." },
  },
  required: ["reply", "readyToLock"],
};

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
  const out = await structured(c,
    `You are a Socratic research mentor. Here is the current ${STAGE}:\n---\n${docText}\n---\n` +
    `Conversation so far:\n${convo}\n\n` +
    `Respond with ONE short, probing reply — challenge a weak assumption, expose a gap, or push the thesis to be sharper — and judge whether the ${STAGE} is now solid enough to lock and start writing. ` +
    `Do not rewrite the ${STAGE}; that happens when the author hits Regenerate.`,
    REPLY_SCHEMA, 1024, MODEL);
  const replyText = String(out.reply || "").trim();
  const ready = !!out.readyToLock;
  await addArtifact(COURSE_ID, { stage: STAGE, type: "message", role: "mysensei", content: replyText });

  const fresh = await fetchProject(COURSE_ID);
  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: STAGE, status: fresh.course.status,
    document: docText, thread: STAGE === "plan" ? fresh.planThread : fresh.draftThread,
    languageCode: (fresh.course.settings || {}).languageCode || "en", ready,
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Socratic reply added for ${COURSE_ID} (${STAGE}).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
