// scripts/notify-ready.mjs (arg: step name, e.g. "plan" | "paper" | "downloads")

import nodemailer from "nodemailer";
import { fetchProject } from "./lib/course-store.mjs";

const STEP = process.argv[2] || "update";
const COURSE_ID = process.env.COURSE_ID;

async function main() {
  const from = process.env.MAIL_FROM, pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass || !COURSE_ID) { console.log("notify skipped (missing env)"); return; }
  const proj = await fetchProject(COURSE_ID);
  const to = proj.course.ownerEmail; if (!to) { console.log("no recipient"); return; }
  const url = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/`;
  const t = nodemailer.createTransport({ service: "gmail", auth: { user: from, pass } });
  await t.sendMail({ from, to, subject: `mySensei — your ${STEP} is ready`,
    text: `Your research ${STEP} is ready. Sign in to review it: ${url}\n` });
  console.log("notified", to);
}

main().catch((e) => { console.error(e); process.exit(0); }); // never fail the run
