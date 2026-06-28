// Triggered by the "paper-due" repository_dispatch. Outlines the paper from the
// locked plan, writes each section with web-search grounding (collecting real
// sources), assembles the paper + references, appends a draft artifact, sets
// status draft-talk, and re-renders the project page.
// Env: COURSE_ID, ANTHROPIC_API_KEY, APP_BASE_URL, INTERNAL_TOKEN
import { client, MODEL, researchWithSources, structured } from "../lib/claude.mjs";
import { PAPER_OUTLINE_SCHEMA, outlinePrompt, sectionPrompt, conclusionPrompt, paperToText } from "../lib/paper-model.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, addArtifact, saveCourse, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }
  const proj = await fetchProject(COURSE_ID);
  const subject = proj.course.subject || "";
  const settings = proj.course.settings || {};
  const planText = proj.course.planDoc || "";
  const thread = proj.draftThread || [];

  // Sonnet 4.6 for the write-up (fast); planning already ran on the heavy model.
  const c = client();
  console.log("outlining the paper...");
  const outline = await structured(c, outlinePrompt({ planText, settings, thread }), PAPER_OUTLINE_SCHEMA, 4000, MODEL);

  const sections = [];
  const references = [];
  const seen = new Set();
  const collect = (sources) => { for (const s of sources) if (!seen.has(s.url)) { seen.add(s.url); references.push(s); } };
  // Bound the job: cap sections and enforce an overall budget so it fails loudly
  // (the workflow's report-failure step emails) instead of hanging silently.
  const headings = (outline.headings || []).slice(0, 6);
  const deadline = Date.now() + (Number(process.env.PAPER_BUDGET_MS) || 15 * 60 * 1000);
  let priorText = "", n = 0;
  for (const heading of headings) {
    n += 1;
    if (Date.now() > deadline) throw new Error(`paper generation exceeded its time budget at section ${n}/${headings.length}`);
    console.log(`section ${n}/${headings.length}: ${heading}`);
    const { text, sources } = await researchWithSources(c, sectionPrompt({ subject, settings, planText, heading, priorText, thread }), { model: MODEL });
    sections.push({ heading, body: text });
    collect(sources);
    priorText += `\n\n${heading}\n${text}`;
  }
  console.log("writing the conclusion...");
  const { text: conclusion, sources: concSources } = await researchWithSources(c, conclusionPrompt({ subject, settings, planText, bodyText: priorText, thread }), { model: MODEL });
  collect(concSources);

  const paper = { title: outline.title || subject, subtitle: outline.subtitle || "", abstract: outline.abstract || "", sections, conclusion };
  const paperText = paperToText(paper, references);

  const version = (proj.course.draftVersion || 0) + 1;
  await addArtifact(COURSE_ID, { stage: "draft", type: "draft", version, content: paperText, citations: references });
  await addArtifact(COURSE_ID, { stage: "draft", type: "draft-json", version, content: JSON.stringify({ paper, references }) });

  const curriculum = { ...proj.course, kind: "research", progress: { ...(proj.course.progress || {}), status: "draft-talk" } };
  await saveCourse(COURSE_ID, curriculum);

  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: "draft", status: "draft-talk",
    document: paperText, thread: proj.draftThread || [], languageCode: settings.languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Draft v${version} generated for ${COURSE_ID} (${sections.length} sections, ${references.length} sources).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
