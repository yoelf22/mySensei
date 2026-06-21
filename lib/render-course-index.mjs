// The per-course contents page: the syllabus plus every class created so far,
// so a learner can browse back through all their material. RTL-aware. No quiz.

import { escapeHtml, dirFor } from "./render-lesson.mjs";

const LABELS = {
  en: { contents: "Course contents", syllabus: "Syllabus & overview", attempt: "attempt", none: "No classes have been delivered yet." },
  he: { contents: "תוכן הקורס", syllabus: "תכנית הקורס וסקירה", attempt: "ניסיון", none: "עדיין לא נשלחו שיעורים." },
};
function labelsFor(code) {
  return LABELS[String(code || "").toLowerCase().split("-")[0]] || LABELS.en;
}

export function renderCourseIndexHtml({ curriculum, courseId }) {
  const code = (curriculum.settings && curriculum.settings.languageCode) || "en";
  const dir = dirFor(code);
  const L = labelsFor(code);
  const fm = curriculum.syllabus || {};
  const title = fm.title || curriculum.subject || "";
  const outline = curriculum.outline || [];
  const byId = (id) => outline.find((m) => m.id === id);
  const delivered = (curriculum.progress && curriculum.progress.delivered) || [];
  const cid = encodeURIComponent(courseId);

  const rows = delivered
    .map((d, i) => {
      const mod = byId(d.module);
      const name = mod ? mod.title : `Module ${d.module}`;
      const att = d.attempt && d.attempt > 1 ? ` (${escapeHtml(L.attempt)} ${escapeHtml(String(d.attempt))})` : "";
      const date = d.sentAt ? `<span class="date">${escapeHtml(String(d.sentAt).slice(0, 10))}</span>` : "";
      return (
        `<li><a class="row" href="/c/${cid}/${encodeURIComponent(d.lessonFile)}">` +
        `<span class="num">${i + 1}</span><span class="t">${escapeHtml(name)}${att}</span>${date}</a></li>`
      );
    })
    .join("");

  return `<!doctype html>
<html lang="${escapeHtml(code)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink:#1d1b16; --muted:#6b6457; --bg:#faf8f3; --accent:#b4541f; --line:#e7e1d5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.6 Georgia,"Times New Roman",serif; }
  main { max-width:42rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  .kicker { text-transform:uppercase; letter-spacing:.08em; font-size:.75rem; color:var(--accent); margin:0 0 .25rem; }
  h1 { font-size:1.7rem; line-height:1.25; margin:0 0 1.5rem; }
  a { color:inherit; text-decoration:none; }
  .syllabus { display:block; background:#fff5ec; border:1px solid var(--line); border-inline-start:4px solid var(--accent); border-radius:.4rem; padding:.9rem 1.1rem; margin-bottom:1.5rem; font-family:system-ui,sans-serif; font-weight:bold; color:var(--accent); }
  ol { list-style:none; padding:0; margin:0; }
  .row { display:flex; align-items:center; gap:1rem; padding:1rem .25rem; border-top:1px solid var(--line); }
  .row:hover { background:#fff5ec; }
  .num { flex:0 0 1.9rem; height:1.9rem; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif; font-weight:bold; font-size:.9rem; }
  .t { flex:1; }
  .date { color:var(--muted); font-family:system-ui,sans-serif; font-size:.8rem; }
  .none { color:var(--muted); font-family:system-ui,sans-serif; }
</style>
</head>
<body>
<main>
  <p class="kicker">${escapeHtml(L.contents)}</p>
  <h1>${escapeHtml(title)}</h1>
  <a class="syllabus" href="/c/${cid}/syllabus">${escapeHtml(L.syllabus)}</a>
  ${rows ? `<ol>${rows}</ol>` : `<p class="none">${escapeHtml(L.none)}</p>`}
</main>
</body>
</html>`;
}
