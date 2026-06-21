// The onboarding form page ("What do you want to learn today?").
// Collects subject + angle + settings and POSTs them to the quiz helper
// (worker) as a {type:"onboard", ...} submission. Static except the webhook URL.

import { escapeHtml } from "./render-lesson.mjs";

export function renderOnboardHtml({ webhookUrl, courseId }) {
  const hook = escapeHtml(webhookUrl || "");
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mySensei — What do you want to learn?</title>
<style>
  :root { --ink:#1d1b16; --muted:#6b6457; --bg:#faf8f3; --accent:#b4541f; --line:#e7e1d5; }
  *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,serif;}
  main{max-width:38rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;}
  h1{font-size:1.7rem;margin:0 0 .3rem;} p.sub{color:var(--muted);margin:0 0 2rem;}
  label{display:block;font-family:system-ui,sans-serif;font-size:.95rem;font-weight:bold;margin:1.3rem 0 .35rem;}
  input[type=text],textarea,input[type=time]{width:100%;font:inherit;padding:.6rem .7rem;border:1px solid var(--line);border-radius:.4rem;background:#fff;}
  textarea{min-height:4.5rem;resize:vertical;}
  .row{display:flex;gap:1.2rem;flex-wrap:wrap;font-family:system-ui,sans-serif;font-size:1rem;}
  .row label{font-weight:normal;margin:.2rem 0;display:flex;align-items:center;gap:.4rem;}
  button{margin-top:2rem;font:inherit;background:var(--accent);color:#fff;border:0;border-radius:.4rem;padding:.75rem 1.5rem;cursor:pointer;}
  #done{display:none;margin-top:1.5rem;font-family:system-ui,sans-serif;font-weight:bold;color:#1a7f37;}
  #err{display:none;margin-top:1rem;font-family:system-ui,sans-serif;color:var(--accent);}
  .hint{font-family:system-ui,sans-serif;font-size:.82rem;color:var(--muted);font-weight:normal;margin-top:.2rem;}
</style>
</head>
<body>
<main>
  <h1>What do you want to learn today?</h1>
  <p class="sub">Tell me the subject and a few preferences. I'll research it, send you a short placement check, then build your course.</p>
  <form id="f">
    <label>Subject<textarea name="subject" required placeholder="A topic, a question, or a goal — in your own words"></textarea></label>
    <label>Any particular angle or goal? <span class="hint">(optional)</span><input type="text" name="angle" placeholder="What would make this time well spent"></label>
    <label>Your email <span class="hint">(where your placement check and lessons are sent)</span><input type="email" name="email" required placeholder="you@example.com"></label>
    <label>Language</label>
    <select name="language">
      <option value="en" data-name="English" selected>English</option>
      <option value="he" data-name="Hebrew">עברית — Hebrew</option>
      <option value="ar" data-name="Arabic">العربية — Arabic</option>
      <option value="es" data-name="Spanish">Español — Spanish</option>
      <option value="fr" data-name="French">Français — French</option>
      <option value="de" data-name="German">Deutsch — German</option>
      <option value="it" data-name="Italian">Italiano — Italian</option>
      <option value="pt" data-name="Portuguese">Português — Portuguese</option>
      <option value="ru" data-name="Russian">Русский — Russian</option>
    </select>
    <label>Lesson length</label>
    <div class="row">
      <label><input type="radio" name="chunkMinutes" value="5"> 5 min</label>
      <label><input type="radio" name="chunkMinutes" value="10" checked> 10 min</label>
      <label><input type="radio" name="chunkMinutes" value="30"> 30 min</label>
    </div>
    <label>How often</label>
    <div class="row">
      <label><input type="radio" name="cadence" value="daily" checked> Every day</label>
      <label><input type="radio" name="cadence" value="weekly"> Once a week</label>
    </div>
    <label>Delivery time<input type="time" name="deliveryTime" value="07:00"></label>
    <label>Timezone<input type="text" name="timezone"></label>
    <button type="submit">Start my course</button>
    <p id="done">Thanks — check your email shortly for a short placement check.</p>
    <p id="err"></p>
  </form>
</main>
<script>
(function(){
  var HOOK = ${JSON.stringify(webhookUrl || "")};
  var tz = document.querySelector('[name=timezone]');
  try { tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch(e){ tz.value = "UTC"; }
  var f = document.getElementById("f"), done = document.getElementById("done"), err = document.getElementById("err");
  f.addEventListener("submit", function(e){
    e.preventDefault();
    err.style.display = "none";
    var d = new FormData(f);
    var langSel = f.querySelector('select[name=language]');
    var langCode = langSel.value;
    var langName = langSel.options[langSel.selectedIndex].getAttribute('data-name') || langCode;
    var payload = {
      type:"onboard",
      courseId:${JSON.stringify(courseId || "")},
      subject:(d.get("subject")||"").trim(),
      email:(d.get("email")||"").trim(),
      angle:(d.get("angle")||"").trim(),
      language:langName,
      languageCode:langCode,
      chunkMinutes: parseInt(d.get("chunkMinutes"),10),
      cadence: d.get("cadence"),
      deliveryTime: d.get("deliveryTime") || "07:00",
      timezone: d.get("timezone") || "UTC",
      workweekDays: [0,1,2,3,4,5,6]
    };
    if(!payload.subject){ err.textContent="Please enter a subject."; err.style.display="block"; return; }
    if(!payload.email){ err.textContent="Please enter your email."; err.style.display="block"; return; }
    if(!HOOK){ err.textContent="No submit endpoint configured."; err.style.display="block"; return; }
    f.querySelector("button").disabled = true;
    fetch(HOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
      .then(function(r){ if(!r.ok) throw new Error(); f.querySelector("button").style.display="none"; done.style.display="block"; })
      .catch(function(){ err.textContent="Could not reach the server — please try again."; err.style.display="block"; f.querySelector("button").disabled=false; });
  });
})();
</script>
</body>
</html>`;
}
