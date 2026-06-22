// scripts/report-failure.mjs
// Run by a workflow's `if: failure()` step: records last_error on the course and
// emails the owner. Best-effort — never throws and never exits non-zero, so it
// can't fail the run a second time or mask the original error.
import nodemailer from "nodemailer";
import { reportError } from "./lib/course-store.mjs";

export async function run() {
  const COURSE_ID = process.env.COURSE_ID || "";
  const runUrl =
    `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY || ""}` +
    `/actions/runs/${process.env.GITHUB_RUN_ID || ""}`;
  const note = `A mySensei job failed for course ${COURSE_ID || "(unknown)"}. See ${runUrl}`;
  if (COURSE_ID) {
    try { await reportError(COURSE_ID, note); } catch (e) { console.error("reportError:", e.message); }
  }
  const from = process.env.MAIL_FROM, pass = process.env.GMAIL_APP_PASSWORD, to = process.env.OWNER_EMAIL;
  if (from && pass && to) {
    try {
      const t = nodemailer.createTransport({ service: "gmail", auth: { user: from, pass } });
      await t.sendMail({ from, to, subject: "mySensei: a course job failed", text: note + "\n" });
      console.log("owner notified:", to);
    } catch (e) { console.error("owner email failed:", e.message); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => console.error(e)); // never rethrow
}
