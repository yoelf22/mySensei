// Render a lesson object into one self-contained HTML file.
// Text in the file, media by remote URL, quiz at the bottom that POSTs its
// result to the quiz-helper webhook. RTL-aware. No external assets.

const RTL = new Set(["he", "ar", "fa", "ur"]);

export function dirFor(languageCode) {
  return RTL.has(String(languageCode || "").toLowerCase().split("-")[0]) ? "rtl" : "ltr";
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isHttp(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function renderSections(sections = []) {
  return sections
    .map((s) => {
      const head = s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : "";
      const paras = (s.paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      const bullets = (s.bullets && s.bullets.length)
        ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
        : "";
      return `<section>${head}${paras}${bullets}</section>`;
    })
    .join("");
}

function renderMedia(media = {}, labels) {
  const bits = [];
  if (isHttp(media.imageUrl)) {
    bits.push(
      `<figure><img src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.imageAlt || "")}" loading="lazy"></figure>`,
    );
  }
  if (isHttp(media.linkUrl)) {
    const label = media.linkLabel || labels.learnMore;
    bits.push(
      `<p class="more"><a href="${escapeHtml(media.linkUrl)}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a></p>`,
    );
  }
  return bits.join("");
}

function renderQuiz(quiz = [], labels) {
  return quiz
    .map((q, qi) => {
      const opts = (q.options || [])
        .map(
          (opt, oi) =>
            `<label class="opt"><input type="radio" name="q${qi}" value="${oi}"> <span>${escapeHtml(opt)}</span></label>`,
        )
        .join("");
      return `<fieldset class="q"><legend>${qi + 1}. ${escapeHtml(q.question)}</legend>${opts}</fieldset>`;
    })
    .join("");
}

// UI strings, in the course language where we have them, English fallback.
const LABELS = {
  en: { learnMore: "Learn more", quizTitle: "Quick check", submit: "Submit quiz", passed: "You've got it. The next lesson will move on.", failed: "Not quite — the next lesson will revisit this with different material.", answerAll: "Please answer every question first.", sent: "Result sent.", offline: "Could not reach the server — check your connection and resubmit." },
  he: { learnMore: "למדו עוד", quizTitle: "בדיקה מהירה", submit: "שלח מבדק", passed: "הבנת. השיעור הבא ימשיך הלאה.", failed: "לא לגמרי — השיעור הבא יחזור על זה בחומר אחר.", answerAll: "נא לענות על כל השאלות.", sent: "התוצאה נשלחה.", offline: "לא התקבלה גישה לשרת — בדקו את החיבור ושלחו שוב." },
};

function labelsFor(code) {
  return LABELS[String(code || "").toLowerCase().split("-")[0]] || LABELS.en;
}

/**
 * Build the full HTML document.
 * opts: { curriculum, lesson, webhookUrl }
 */
export function renderLessonHtml({ curriculum, lesson, webhookUrl }) {
  const code = curriculum.settings.languageCode || "en";
  const dir = dirFor(code);
  const labels = labelsFor(code);
  const passThreshold = curriculum.settings.passThreshold ?? 0.7;

  const meta = {
    module: lesson.moduleId,
    attempt: lesson.attempt ?? 1,
    total: (lesson.quiz || []).length,
    correct: (lesson.quiz || []).map((q) => q.correctIndex),
    threshold: passThreshold,
    webhook: webhookUrl || "",
  };

  const body = `
    <header><p class="kicker">${escapeHtml(curriculum.subject || "")}</p><h1>${escapeHtml(lesson.title || "")}</h1></header>
    ${lesson.intro ? `<p class="intro">${escapeHtml(lesson.intro)}</p>` : ""}
    ${lesson.keyIdea ? `<aside class="key">${escapeHtml(lesson.keyIdea)}</aside>` : ""}
    ${renderSections(lesson.sections)}
    ${renderMedia(lesson.media, labels)}
    ${(lesson.takeaways && lesson.takeaways.length)
      ? `<section class="takeaways"><h2>✓</h2><ul>${lesson.takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></section>`
      : ""}
    <form id="quiz"><h2>${escapeHtml(labels.quizTitle)}</h2>${renderQuiz(lesson.quiz, labels)}
      <button type="submit">${escapeHtml(labels.submit)}</button>
      <p id="result" role="status"></p>
    </form>`;

  return `<!doctype html>
<html lang="${escapeHtml(code)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(lesson.title || "mySensei")}</title>
<style>
  :root { --ink:#1d1b16; --muted:#6b6457; --bg:#faf8f3; --accent:#b4541f; --line:#e7e1d5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.6 Georgia,"Times New Roman",serif; }
  main { max-width:42rem; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  .kicker { text-transform:uppercase; letter-spacing:.08em; font-size:.75rem; color:var(--accent); margin:0 0 .25rem; }
  h1 { font-size:1.9rem; line-height:1.2; margin:0 0 1rem; }
  h2 { font-size:1.15rem; margin:2rem 0 .5rem; }
  .intro { font-size:1.15rem; color:var(--muted); }
  .key { background:#fff5ec; border-inline-start:4px solid var(--accent); padding:.9rem 1.1rem; margin:1.5rem 0; border-radius:.3rem; }
  figure { margin:1.5rem 0; } img { max-width:100%; height:auto; border-radius:.4rem; }
  .more a { color:var(--accent); text-decoration:none; font-weight:bold; }
  .takeaways h2 { color:var(--accent); }
  ul { padding-inline-start:1.2rem; }
  form { margin-top:2.5rem; border-top:1px solid var(--line); padding-top:1.5rem; }
  .q { border:1px solid var(--line); border-radius:.5rem; padding:1rem 1.2rem; margin:1rem 0; }
  legend { font-weight:bold; padding:0 .4rem; }
  .opt { display:block; padding:.35rem 0; cursor:pointer; font-family:system-ui,sans-serif; font-size:1rem; }
  button { font:inherit; background:var(--accent); color:#fff; border:0; border-radius:.4rem; padding:.7rem 1.4rem; cursor:pointer; }
  #result { font-family:system-ui,sans-serif; font-weight:bold; margin-top:1rem; }
  .ok { color:#1a7f37; } .no { color:var(--accent); }
</style>
</head>
<body>
<main>${body}</main>
<script id="meta" type="application/json">${JSON.stringify(meta)}</script>
<script>
(function () {
  var meta = JSON.parse(document.getElementById("meta").textContent);
  var L = ${JSON.stringify(labels)};
  var form = document.getElementById("quiz");
  var out = document.getElementById("result");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var score = 0;
    for (var i = 0; i < meta.total; i++) {
      var sel = form.querySelector('input[name="q' + i + '"]:checked');
      if (!sel) { out.textContent = L.answerAll; out.className = "no"; return; }
      if (parseInt(sel.value, 10) === meta.correct[i]) score++;
    }
    var passed = meta.total > 0 && score / meta.total >= meta.threshold;
    out.textContent = score + "/" + meta.total + " — " + (passed ? L.passed : L.failed);
    out.className = passed ? "ok" : "no";
    form.querySelector("button").disabled = true;
    if (!meta.webhook) return;
    fetch(meta.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: meta.module, attempt: meta.attempt, score: score, total: meta.total, passed: passed }),
    }).then(function () {
      out.textContent += " · " + L.sent;
    }).catch(function () {
      out.textContent += " · " + L.offline;
    });
  });
})();
</script>
</body>
</html>`;
}
