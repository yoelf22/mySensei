// Generic "subject + intro + one link" emailer, used for the entry email and
// the assessment-link email. Env: MAIL_FROM, MAIL_TO, GMAIL_APP_PASSWORD,
// EMAIL_SUBJECT, EMAIL_INTRO, EMAIL_URL.

import nodemailer from "nodemailer";

async function main() {
  const from = process.env.MAIL_FROM;
  const to = process.env.MAIL_TO || from;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const subject = process.env.EMAIL_SUBJECT || "mySensei";
  const intro = process.env.EMAIL_INTRO || "";
  const url = process.env.EMAIL_URL || "";
  if (!from || !pass || !url) {
    console.error("MAIL_FROM, GMAIL_APP_PASSWORD and EMAIL_URL must be set.");
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
    subject,
    text: `${intro}\n\n${url}\n`,
    html: `<p>${intro}</p><p><a href="${url}">${url}</a></p>`,
  });
  console.log(`Sent "${subject}" link to ${to}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
