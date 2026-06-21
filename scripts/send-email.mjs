// Email the most recently delivered lesson as a Worker page link via Gmail SMTP.
// Reads the course from D1 via the Worker API.
//
// Env: GMAIL_APP_PASSWORD (required), MAIL_FROM (Gmail address that owns the app
//      password), COURSE_ID (required), APP_BASE_URL (required),
//      INTERNAL_TOKEN (required), MAIL_TO (defaults to course email).

import nodemailer from "nodemailer";
import { fetchCourse } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  const curriculum = await fetchCourse(COURSE_ID);

  const delivered = (curriculum.progress && curriculum.progress.delivered) || [];
  const latest = delivered[delivered.length - 1];
  if (!latest) { console.log("No delivered lesson to email."); process.exit(0); }

  const link = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/c/${COURSE_ID}/${latest.lessonFile}`;

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

  const subjectLine = `mySensei — your next lesson`;
  await transport.sendMail({
    from,
    to,
    subject: subjectLine,
    text:
      `Your next mySensei lesson on "${curriculum.subject}":\n\n${link}\n\n` +
      `Open it in any browser, read it, and take the quiz at the bottom.\n`,
    html:
      `<p>Your next mySensei lesson on "<b>${curriculum.subject}</b>":</p>` +
      `<p><a href="${link}">${link}</a></p>` +
      `<p>Open it in any browser, read it, and take the quiz at the bottom.</p>`,
  });
  console.log(`Sent lesson link ${link} to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
