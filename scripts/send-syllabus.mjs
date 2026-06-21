// Render the approved syllabus as a standalone HTML document and email a link to it.
// Stores the page in D1 via the Worker API and emails a Worker page link.
//
// Env: GMAIL_APP_PASSWORD (required), MAIL_FROM (required), COURSE_ID (required),
//      APP_BASE_URL (required), INTERNAL_TOKEN (required),
//      MAIL_TO (defaults to course email), MYSENSEI_RENDER_ONLY (optional).

import nodemailer from "nodemailer";
import { renderSyllabusHtml } from "../lib/render-syllabus.mjs";
import { fetchCourse, savePage, submitUrl } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  const curriculum = await fetchCourse(COURSE_ID);
  const html = renderSyllabusHtml({ curriculum, webhookUrl: submitUrl(), courseId: COURSE_ID });

  await savePage(COURSE_ID, "syllabus", html);

  if (process.env.MYSENSEI_RENDER_ONLY === "1") {
    console.log("Rendered and saved syllabus page (render-only).");
    return;
  }

  const from = process.env.MAIL_FROM;
  const to = curriculum.settings.email || process.env.MAIL_TO || from;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass) {
    console.error("MAIL_FROM and GMAIL_APP_PASSWORD must be set.");
    process.exit(1);
  }

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: from, pass },
  });

  const link = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/c/${COURSE_ID}/syllabus`;
  await transport.sendMail({
    from, to,
    subject: "mySensei — your course plan is ready",
    text: `Your course plan is ready. Review and approve it here:\n\n${link}\n`,
    html: `<p>Your course plan is ready. Review and approve it here:</p><p><a href="${link}">${link}</a></p>`,
  });
  console.log(`Sent syllabus link ${link} to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
