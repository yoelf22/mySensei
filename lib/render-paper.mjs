import { escapeHtml } from "./render-lesson.mjs";

function paras(text) {
  return String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`).join("");
}
function referencesHtml(references) {
  if (!references || !references.length) return "";
  const items = references.map((r, i) => `<li>[${i + 1}] ${escapeHtml(r.title || r.url)} — <a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></li>`).join("");
  return `<h2>References</h2><ol class="refs">${items}</ol>`;
}
function body(paper, references) {
  const secs = (paper.sections || []).map((s) => `<h2>${escapeHtml(s.heading)}</h2>${paras(s.body)}`).join("");
  return `
    <h1>${escapeHtml(paper.title || "")}</h1>
    ${paper.subtitle ? `<p class="subtitle">${escapeHtml(paper.subtitle)}</p>` : ""}
    ${paper.abstract ? `<h2>Abstract</h2>${paras(paper.abstract)}` : ""}
    ${secs}
    ${paper.conclusion ? `<h2>Conclusion</h2>${paras(paper.conclusion)}` : ""}
    ${referencesHtml(references)}`;
}

export function renderPaperHtml(paper, references = []) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(paper.title || "Paper")}</title>
<style>:root{--ink:#1d1b16;--muted:#6b6457;--bg:#faf8f3;--accent:#b4541f;--line:#e7e1d5;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,"Times New Roman",serif}
main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
h1{font-size:1.9rem;margin:0 0 .3rem}.subtitle{color:var(--muted);font-style:italic;margin:0 0 1.5rem}
h2{font-size:1.25rem;margin:2rem 0 .5rem}.refs{font-size:.92rem;color:var(--muted)}.refs a{color:var(--accent);word-break:break-all}</style>
</head><body><main>${body(paper, references)}</main></body></html>`;
}

export function renderPrintHtml(paper, references = []) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(paper.title || "Paper")}</title>
<style>body{font:12pt/1.5 Georgia,"Times New Roman",serif;color:#111;margin:0}
h1{font-size:20pt;margin:0 0 4pt}.subtitle{font-style:italic;color:#555;margin:0 0 18pt}
h2{font-size:14pt;margin:16pt 0 4pt}.refs{font-size:10pt;color:#333}.refs a{color:#333;word-break:break-all}
@page{margin:2cm}</style></head><body>${body(paper, references)}</body></html>`;
}
