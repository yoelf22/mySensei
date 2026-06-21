// Render the approved syllabus as a standalone HTML document and email it —
// a course overview the learner receives once, separate from daily lessons.
// Also writes syllabus.html at the repo root for history.
//
// Env: GMAIL_APP_PASSWORD (required), MAIL_FROM (required), MAIL_TO (defaults to MAIL_FROM).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { renderSyllabusHtml } from "../lib/render-syllabus.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const curriculum = JSON.parse(fs.readFileSync(path.join(ROOT, "curriculum.json"), "utf8"));
  const html = renderSyllabusHtml({ curriculum });
  // Publish into lessons/ so the Pages deploy serves it at a one-click URL.
  fs.mkdirSync(path.join(ROOT, "lessons"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "lessons", "course-syllabus.html"), html);

  if (process.env.MYSENSEI_RENDER_ONLY === "1") {
    console.log("Rendered lessons/course-syllabus.html (render-only).");
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

  const subject = `mySensei · ${curriculum.subject} · course syllabus`;
  const base = (process.env.LESSONS_BASE_URL || "").replace(/\/+$/, "");

  if (base) {
    const url = `${base}/course-syllabus.html`;
    await transport.sendMail({
      from,
      to,
      subject,
      text: `Here's the syllabus for your mySensei course on "${curriculum.subject}":\n\n${url}\n\nLessons begin on your schedule.\n`,
      html: `<p>Here's the syllabus for your mySensei course on "<b>${curriculum.subject}</b>":</p><p><a href="${url}">${url}</a></p><p>Lessons begin on your schedule.</p>`,
    });
    console.log(`Sent syllabus link ${url} to ${to}`);
    return;
  }

  // Fallback: attach the file.
  await transport.sendMail({
    from,
    to,
    subject,
    text: `Here's the syllabus for your mySensei course on "${curriculum.subject}". Open the attached file in any browser.\n`,
    attachments: [
      { filename: "course-syllabus.html", content: html, contentType: "text/html; charset=utf-8" },
    ],
  });
  console.log(`Sent the syllabus (attachment) to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
