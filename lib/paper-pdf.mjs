import puppeteer from "puppeteer";
import { renderPrintHtml } from "./render-paper.mjs";

export async function paperToPdf(paper, references = []) {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderPrintHtml(paper, references), { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "2cm", bottom: "2cm", left: "2cm", right: "2cm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
