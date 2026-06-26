// Triggered by the "plan-due" repository_dispatch (first plan) and by
// "regenerate" (revised plan). Researches the question, generates/revises the
// plan, appends a plan artifact, renders the thread page, sets status plan-talk.
// Env: COURSE_ID, PLAN_PAYLOAD (first run only), ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, heavyClient, HEAVY_MODEL, researchWithSources, structured } from "../lib/claude.mjs";
import { PLAN_SCHEMA, planPrompt, planToText } from "../lib/plan-model.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const proj = await fetchProject(COURSE_ID);
  const first = !!process.env.PLAN_PAYLOAD;
  const payload = first ? JSON.parse(process.env.PLAN_PAYLOAD) : {
    subject: proj.course.subject, angle: proj.course.angle, settings: proj.course.settings || {},
  };
  const subject = payload.subject, angle = payload.angle || "", settings = payload.settings || {};
  const thread = proj.planThread || [];

  const c = client();
  const { text: notes } = await researchWithSources(c, `Research "${subject}"${angle ? ` (angle: ${angle})` : ""}. Summarize what bears on the thesis and credible source venues. Keep it tight.`, { model: HEAVY_MODEL });
  const plan = await structured(heavyClient(), planPrompt({ subject, angle, settings, thread, notes }), PLAN_SCHEMA, 6000);

  const version = (proj.course.planVersion || 0) + 1;
  await addArtifact(COURSE_ID, { stage: "plan", type: "plan", version, content: planToText(plan), citations: [] });

  // Persist state: kind=research, status=plan-talk, keep subject/angle/settings.
  const curriculum = { ...proj.course, subject, angle, settings, kind: "research", progress: { ...(proj.course.progress || {}), status: "plan-talk" } };
  await saveCourse(COURSE_ID, curriculum);

  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: "plan", status: "plan-talk",
    document: planToText(plan), thread, languageCode: settings.languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Plan v${version} generated for ${COURSE_ID}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
