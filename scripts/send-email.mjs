// Email the most recently generated lesson as an HTML attachment via Gmail SMTP.
//
// Env: GMAIL_APP_PASSWORD (required), MAIL_FROM (Gmail address that owns the app
//      password), MAIL_TO (recipient; defaults to MAIL_FROM).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function main() {
  const latestPath = path.join(ROOT, "lessons", "latest.txt");
  if (!fs.existsSync(latestPath)) {
    console.log("No lesson to send (lessons/latest.txt missing) — exiting.");
    return;
  }
  const relPath = read("lessons/latest.txt").trim();
  if (!relPath) {
    console.log("No lesson path recorded — exiting.");
    return;
  }
  const html = read(relPath);
  const curriculum = JSON.parse(read("curriculum.json"));

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

  const lesson = curriculum.progress.delivered.at(-1) || {};
  const subjectLine = `mySensei · ${curriculum.subject} · lesson ${lesson.module ?? ""}`.trim();

  const base = (process.env.LESSONS_BASE_URL || "").replace(/\/+$/, "");
  if (base) {
    // Hosted-link delivery (lesson is published to Cloudflare Pages).
    const url = `${base}/${path.basename(relPath)}`;
    await transport.sendMail({
      from,
      to,
      subject: subjectLine,
      text:
        `Your next mySensei lesson on "${curriculum.subject}":\n\n${url}\n\n` +
        `Open it in any browser, read it, and take the quiz at the bottom.\n`,
      html:
        `<p>Your next mySensei lesson on "<b>${curriculum.subject}</b>":</p>` +
        `<p><a href="${url}">${url}</a></p>` +
        `<p>Open it in any browser, read it, and take the quiz at the bottom.</p>`,
    });
    console.log(`Sent link ${url} to ${to}`);
    return;
  }

  // Fallback: attach the self-contained file.
  await transport.sendMail({
    from,
    to,
    subject: subjectLine,
    text:
      `Your next mySensei lesson on "${curriculum.subject}" is attached.\n` +
      `Open the attached file in any browser, read it, and take the quiz at the bottom.\n`,
    attachments: [
      { filename: path.basename(relPath), content: html, contentType: "text/html; charset=utf-8" },
    ],
  });
  console.log(`Sent ${relPath} to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
