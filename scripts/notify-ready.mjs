// scripts/notify-ready.mjs (arg: step name, e.g. "plan" | "paper" | "downloads")

import nodemailer from "nodemailer";
import { fetchProject, mintMagicLink } from "./lib/course-store.mjs";

const STEP = process.argv[2] || "update";
const COURSE_ID = process.env.COURSE_ID;

async function main() {
  const from = process.env.MAIL_FROM, pass = process.env.GMAIL_APP_PASSWORD;
  if (!from || !pass || !COURSE_ID) { console.log("notify skipped (missing env)"); return; }
  const proj = await fetchProject(COURSE_ID);
  const to = proj.course.ownerEmail; if (!to) { console.log("no recipient"); return; }
  // Prefer a one-click sign-in link so the recipient lands straight on the
  // verify page; fall back to the homepage if minting fails for any reason.
  let url = `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/`;
  try { url = await mintMagicLink(to); } catch (e) { console.error("magic-link mint failed, using homepage:", e.message); }
  const t = nodemailer.createTransport({ service: "gmail", auth: { user: from, pass } });
  await t.sendMail({ from, to, subject: `mySensei — your ${STEP} is ready`,
    text: `Your research ${STEP} is ready. Click to sign in and review it: ${url}\nThis link is single-use and expires in 7 days; if it stops working, you can request a fresh one from that page.\n` });
  console.log("notified", to);
}

main().catch((e) => { console.error(e); process.exit(0); }); // never fail the run
