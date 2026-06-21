// The placement-assessment page. Renders the laddered diagnostic questions;
// on submit it computes, per question, {level, correct} and POSTs them to the
// quiz helper as a {type:"assessment", results:[...]} submission. The grader
// (Claude, in a GitHub Action) judges the level from that pattern.

import { escapeHtml, dirFor } from "./render-lesson.mjs";

// "I don't know", per course language (BCP-47 prefix). English fallback.
const IDK = {
  en: "I don't know",
  he: "לא יודע/ת",
  ar: "لا أعرف",
  es: "No lo sé",
  fr: "Je ne sais pas",
  de: "Ich weiß es nicht",
  it: "Non lo so",
  pt: "Não sei",
  ru: "Не знаю",
};

export function renderAssessmentHtml({ questions = [], webhookUrl, languageCode = "en", subject = "" }) {
  const dir = dirFor(languageCode);
  const idk = IDK[String(languageCode || "en").toLowerCase().split("-")[0]] || IDK.en;
  const meta = questions.map((q) => ({ level: q.level, correct: q.correctIndex }));

  const blocks = questions
    .map((q, qi) => {
      const opts = (q.options || [])
        .map((opt, oi) => `<label class="opt"><input type="radio" name="q${qi}" value="${oi}"> <span>${escapeHtml(opt)}</span></label>`)
        .join("");
      // "I don't know" is appended last; its index never equals correctIndex,
      // so it scores as not-correct (a clean "no knowledge" signal, not a guess).
      const idkOpt = `<label class="opt idk"><input type="radio" name="q${qi}" value="${(q.options || []).length}"> <span>${escapeHtml(idk)}</span></label>`;
      return `<fieldset class="q"><legend>${qi + 1}. ${escapeHtml(q.question)}</legend>${opts}${idkOpt}</fieldset>`;
    })
    .join("");

  return `<!doctype html>
<html lang="${escapeHtml(languageCode)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mySensei — placement check</title>
<style>
  :root{--ink:#1d1b16;--muted:#6b6457;--bg:#faf8f3;--accent:#b4541f;--line:#e7e1d5;}
  *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,serif;}
  main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;}
  h1{font-size:1.6rem;margin:0 0 .3rem;} p.sub{color:var(--muted);margin:0 0 1.5rem;}
  .q{border:1px solid var(--line);border-radius:.5rem;padding:1rem 1.2rem;margin:1rem 0;}
  legend{font-weight:bold;padding:0 .4rem;}
  .opt{display:block;padding:.35rem 0;cursor:pointer;font-family:system-ui,sans-serif;font-size:1rem;}
  .opt.idk span{color:var(--muted);font-style:italic;}
  button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:.4rem;padding:.7rem 1.4rem;cursor:pointer;margin-top:1rem;}
  #done{display:none;margin-top:1.3rem;font-family:system-ui,sans-serif;font-weight:bold;color:#1a7f37;}
  #err{display:none;margin-top:1rem;font-family:system-ui,sans-serif;color:var(--accent);}
</style>
</head>
<body>
<main>
  <h1>Quick placement check</h1>
  <p class="sub">${escapeHtml(subject)} — a few questions, easy to hard. Answer by gut; this just sets how deep your lessons start. Then I'll build your course and email it.</p>
  <form id="f">${blocks}
    <button type="submit">Submit</button>
    <p id="done">Thanks — I'll judge your level, build your course, and email your syllabus shortly.</p>
    <p id="err"></p>
  </form>
</main>
<script id="meta" type="application/json">${JSON.stringify(meta)}</script>
<script>
(function(){
  var HOOK = ${JSON.stringify(webhookUrl || "")};
  var meta = JSON.parse(document.getElementById("meta").textContent);
  var f = document.getElementById("f"), done = document.getElementById("done"), err = document.getElementById("err");
  f.addEventListener("submit", function(e){
    e.preventDefault();
    err.style.display = "none";
    var results = [];
    for (var i=0;i<meta.length;i++){
      var sel = f.querySelector('input[name="q'+i+'"]:checked');
      if(!sel){ err.textContent="Please answer every question first."; err.style.display="block"; return; }
      results.push({ level: meta[i].level, correct: parseInt(sel.value,10) === meta[i].correct });
    }
    if(!HOOK){ err.textContent="No submit endpoint configured."; err.style.display="block"; return; }
    f.querySelector("button").disabled = true;
    fetch(HOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"assessment",results:results})})
      .then(function(r){ if(!r.ok) throw new Error(); f.querySelector("button").style.display="none"; done.style.display="block"; })
      .catch(function(){ err.textContent="Could not reach the server — please try again."; err.style.display="block"; f.querySelector("button").disabled=false; });
  });
})();
</script>
</body>
</html>`;
}
