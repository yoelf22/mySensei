// Triggered by the "dialogue" repository_dispatch. Generates ONE Socratic reply
// to the latest author message for STAGE, appends it, re-renders the page.
// Env: COURSE_ID, STAGE, ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, MODEL, structured } from "../lib/claude.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";

// mySensei answers AND judges whether the work is solid enough to lock. The
// verdict + a written "what's missing" are persisted so that when the author
// clicks Lock, the worker can either proceed or show exactly what to fix.
const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "One short, conversational line reacting to the author's latest message (acknowledge progress, or note the key tension). The detailed questions go in 'issues', not here. Do not rewrite the document." },
    readyToLock: { type: "boolean", description: "Your judgment as a tough but fair critic: true ONLY when the thesis is clear, defensible, and well-scoped enough to start writing, with no substantive objection remaining; false if any weak assumption, gap, or vagueness is still unresolved." },
    issues: { type: "string", description: "The COMPLETE current list of open questions the author must ANSWER before this can be written — ALL of them, not one at a time, refreshed each turn: drop any the latest answers resolved and add any new ones they raised. Format as '- ' bullet lines, each concrete and directly answerable (e.g. '- Which single thesis are you defending: X or Y?'). Empty string only if readyToLock is true." },
  },
  required: ["reply", "readyToLock", "issues"],
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
    `Reply with a short conversational line, then list the COMPLETE set of open questions the author still needs to answer to make the ${STAGE} solid enough to lock — all of them at once, refreshed for what's now answered or newly raised — and judge whether it's ready. ` +
    `Do not rewrite the ${STAGE}; that happens when the author hits Regenerate.`,
    REPLY_SCHEMA, 1024, MODEL);
  const replyText = String(out.reply || "").trim();
  const ready = !!out.readyToLock;
  const issues = ready ? "" : String(out.issues || "").trim();
  await addArtifact(COURSE_ID, { stage: STAGE, type: "message", role: "mysensei", content: replyText });

  const fresh = await fetchProject(COURSE_ID);
  // Persist the verdict so the worker can gate Lock without re-running the AI.
  await saveCourse(COURSE_ID, { ...fresh.course, progress: { ...(fresh.course.progress || {}), readyToLock: ready, lockIssues: issues } });
  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: STAGE, status: fresh.course.status,
    document: docText, thread: STAGE === "plan" ? fresh.planThread : fresh.draftThread,
    languageCode: (fresh.course.settings || {}).languageCode || "en", ready, openQuestions: issues,
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Socratic reply added for ${COURSE_ID} (${STAGE}).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
