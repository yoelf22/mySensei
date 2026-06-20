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
  fs.writeFileSync(path.join(ROOT, "syllabus.html"), html);

  const from = process.env.MAIL_FROM;
  const to = process.env.MAIL_TO || from;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass) {
    console.error("MAIL_FROM and GMAIL_APP_PASSWORD must be set.");
    process.exit(1);
  }

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: from, pass },
  });

  await transport.sendMail({
    from,
    to,
    subject: `mySensei · ${curriculum.subject} · course syllabus`,
    text:
      `Here's the syllabus for your mySensei course on "${curriculum.subject}".\n` +
      `Open the attached file in any browser to see the full path. Lessons begin on your schedule.\n`,
    attachments: [
      { filename: "course-syllabus.html", content: html, contentType: "text/html; charset=utf-8" },
    ],
  });

  console.log(`Sent the syllabus to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
