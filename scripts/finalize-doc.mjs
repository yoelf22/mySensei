// Triggered by the "finalize-due" repository_dispatch (on lock-the-paper).
// Reads the locked structured paper, builds PDF + .docx, stores them in R2,
// sets status final-ready, and re-renders the project page with downloads.
// Env: COURSE_ID, APP_BASE_URL, INTERNAL_TOKEN
import { paperToPdf } from "../lib/paper-pdf.mjs";
import { paperToDocx } from "../lib/paper-docx.mjs";
import { renderProjectHtml } from "../lib/render-project.mjs";
import { fetchProject, saveCourse, savePage, putFile, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  const proj = await fetchProject(COURSE_ID);
  let data;
  try { data = JSON.parse(proj.course.draftJson || "{}"); } catch { data = {}; }
  const paper = data.paper;
  const references = data.references || [];
  if (!paper) { console.error("no locked paper (draftJson missing)"); process.exit(1); }

  const [pdf, docx] = await Promise.all([paperToPdf(paper, references), paperToDocx(paper, references)]);
  await putFile(COURSE_ID, "pdf", pdf, "application/pdf");
  await putFile(COURSE_ID, "docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

  const curriculum = { ...proj.course, kind: "research", progress: { ...(proj.course.progress || {}), status: "final-ready" } };
  await saveCourse(COURSE_ID, curriculum);

  const settings = proj.course.settings || {};
  const html = renderProjectHtml({
    courseId: COURSE_ID, webhookUrl: submitUrl(), stage: "draft", status: "final-ready",
    document: proj.course.draftDoc || "", thread: proj.draftThread || [],
    downloads: { pdf: `/c/${COURSE_ID}/download/pdf`, docx: `/c/${COURSE_ID}/download/docx` },
    languageCode: settings.languageCode || "en",
  });
  await savePage(COURSE_ID, "project", html);
  console.log(`Finalized ${COURSE_ID}: PDF + DOCX stored, status final-ready.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
