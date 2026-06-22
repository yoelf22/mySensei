// Email the placement-check link to the learner who owns the course. The
// recipient is read from D1 (settings.email = the course owner's account), NOT
// from the onboarding form — the form no longer collects an email, so routing
// it through the dispatch payload sent every placement check to MAIL_FROM.
//
// Env: GMAIL_APP_PASSWORD (required), MAIL_FROM (required), COURSE_ID (required),
//      APP_BASE_URL (required), INTERNAL_TOKEN (required), MAIL_TO (fallback).

import nodemailer from "nodemailer";
import { fetchCourse } from "./lib/course-store.mjs";

const COURSE_ID = process.env.COURSE_ID;
if (!COURSE_ID) { console.error("COURSE_ID is required"); process.exit(1); }

async function main() {
  const curriculum = await fetchCourse(COURSE_ID);
  const from = process.env.MAIL_FROM;
  const to = (curriculum.settings && curriculum.settings.email) || process.env.MAIL_TO || from;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass) {
    console.error("MAIL_FROM and GMAIL_APP_PASSWORD must be set.");
    process.exit(1);
  }

  const base = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const link = `${base}/c/${COURSE_ID}/assessment`;
  const intro =
    "Here's a short placement check. Answer the questions and I'll judge your level, " +
    "build your course, and email your syllabus.";

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: from, pass },
  });
  await transport.sendMail({
    from, to,
    subject: "mySensei — your placement check",
    text: `${intro}\n\n${link}\n`,
    html: `<p>${intro}</p><p><a href="${link}">${link}</a></p>`,
  });
  console.log(`Sent placement check ${link} to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
