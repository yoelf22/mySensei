// Render the onboarding form to lessons/onboard.html so the Pages deploy serves
// it. The entry email links here. Env: QUIZ_WEBHOOK_URL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderOnboardHtml } from "../lib/render-onboard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(ROOT, "lessons"), { recursive: true });
const html = renderOnboardHtml({ webhookUrl: process.env.QUIZ_WEBHOOK_URL || "" });
fs.writeFileSync(path.join(ROOT, "lessons", "onboard.html"), html);
console.log("Rendered lessons/onboard.html");
