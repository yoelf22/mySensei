// Render the approved syllabus into one self-contained HTML document — a
// standalone "course overview" the learner receives, separate from the daily
// lessons. No quiz. Shares the lesson aesthetic and RTL handling.

import { escapeHtml, dirFor } from "./render-lesson.mjs";

const LABELS = {
  en: {
    syllabus: "Course syllabus",
    path: "Your path",
    toLevel: "to level",
    arrive: "Lessons arrive",
    daily: "every day",
    weekly: "once a week",
    at: "at",
    modules: "modules",
    approve: "Approve & start my course",
    starting: "Starting your first lesson — it'll arrive in your inbox shortly.",
    approveErr: "Could not reach the server — please try again.",
  },
  he: {
    syllabus: "תכנית הקורס",
    path: "המסלול שלך",
    toLevel: "עד רמה",
    arrive: "השיעורים יגיעו",
    daily: "כל יום",
    weekly: "פעם בשבוע",
    at: "בשעה",
    modules: "יחידות",
    approve: "אישור והתחלת הקורס",
    starting: "מתחילים את השיעור הראשון — הוא יגיע למייל בקרוב.",
    approveErr: "לא התקבלה גישה לשרת — נסו שוב.",
  },
};

function labelsFor(code) {
  return LABELS[String(code || "").toLowerCase().split("-")[0]] || LABELS.en;
}

export function renderSyllabusHtml({ curriculum, webhookUrl }) {
  const code = curriculum.settings.languageCode || "en";
  const dir = dirFor(code);
  const L = labelsFor(code);
  const s = curriculum.settings;
  const outline = curriculum.outline || [];

  const cadenceWord = s.cadence === "weekly" ? L.weekly : L.daily;
  const schedule = `${L.arrive} ${cadenceWord} ${L.at} ${escapeHtml(s.deliveryTime || "")} (${escapeHtml(s.timezone || "")}).`;

  const items = outline
    .map(
      (m, i) =>
        `<li><span class="num">${i + 1}</span><div><h3>${escapeHtml(m.title)}</h3>` +
        `<p>${escapeHtml(m.summary || "")}</p>` +
        `<p class="lvl">→ ${escapeHtml(L.toLevel)} ${escapeHtml(String(m.targetLevel ?? ""))}</p></div></li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${escapeHtml(code)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(L.syllabus)} — ${escapeHtml(curriculum.subject || "")}</title>
<style>
  :root { --ink:#1d1b16; --muted:#6b6457; --bg:#faf8f3; --accent:#b4541f; --line:#e7e1d5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.6 Georgia,"Times New Roman",serif; }
  main { max-width:42rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  .kicker { text-transform:uppercase; letter-spacing:.08em; font-size:.75rem; color:var(--accent); margin:0 0 .25rem; }
  h1 { font-size:1.7rem; line-height:1.25; margin:0 0 1rem; }
  .angle { font-size:1.1rem; color:var(--muted); }
  .path { font-family:system-ui,sans-serif; font-size:.95rem; background:#fff5ec; border-inline-start:4px solid var(--accent); padding:.7rem 1rem; border-radius:.3rem; margin:1.5rem 0; }
  ol { list-style:none; padding:0; margin:2rem 0 0; }
  li { display:flex; gap:1rem; padding:1.1rem 0; border-top:1px solid var(--line); }
  .num { flex:0 0 1.9rem; height:1.9rem; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif; font-weight:bold; }
  h3 { margin:.1rem 0 .3rem; font-size:1.1rem; }
  li p { margin:0; }
  .lvl { color:var(--accent); font-family:system-ui,sans-serif; font-size:.85rem; margin-top:.3rem; }
  footer { margin-top:2.5rem; padding-top:1.2rem; border-top:1px solid var(--line); color:var(--muted); font-family:system-ui,sans-serif; font-size:.9rem; }
  button { font:inherit; background:var(--accent); color:#fff; border:0; border-radius:.4rem; padding:.75rem 1.5rem; cursor:pointer; margin-top:1.8rem; }
  #apdone { font-family:system-ui,sans-serif; font-weight:bold; color:#1a7f37; margin-top:.8rem; }
  #apdone.err { color:var(--accent); }
</style>
</head>
<body>
<main>
  <p class="kicker">${escapeHtml(L.syllabus)}</p>
  <h1>${escapeHtml(curriculum.subject || "")}</h1>
  <p class="angle">${escapeHtml(curriculum.angle || "")}</p>
  <p class="path">${escapeHtml(L.path)}: ${escapeHtml(String(curriculum.startLevel ?? curriculum.level))} → 10 · ${outline.length} ${escapeHtml(L.modules)}</p>
  <ol>${items}</ol>
  <footer>${schedule}</footer>
  ${webhookUrl ? `<form id="ap"><button type="submit">${escapeHtml(L.approve)}</button><p id="apdone" role="status"></p></form>` : ""}
</main>
${webhookUrl ? `<script>
(function(){
  var HOOK = ${JSON.stringify(webhookUrl)};
  var L = ${JSON.stringify({ starting: L.starting, approveErr: L.approveErr })};
  var f = document.getElementById("ap"), o = document.getElementById("apdone");
  f.addEventListener("submit", function(e){
    e.preventDefault();
    f.querySelector("button").disabled = true;
    o.className = ""; o.textContent = L.starting;
    fetch(HOOK, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"approve" }) })
      .then(function(r){ if(!r.ok) throw new Error(); })
      .catch(function(){ o.className="err"; o.textContent = L.approveErr; f.querySelector("button").disabled=false; });
  });
})();
</script>` : ""}
</body>
</html>`;
}
