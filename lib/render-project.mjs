import { escapeHtml, dirFor } from "./render-lesson.mjs";

export function renderProjectHtml({ courseId, webhookUrl, stage, status, document, thread = [], downloads = null, deck = null, languageCode = "en" }) {
  const dir = dirFor(languageCode);
  const meta = JSON.stringify({ webhook: webhookUrl, courseId, stage, status });
  const doc = `<pre class="doc">${escapeHtml(document || "")}</pre>`;
  const msgs = thread.map((m) =>
    `<div class="m ${m.role === "user" ? "me" : "ms"}"><b>${m.role === "user" ? "You" : "mySensei"}</b><p>${escapeHtml(m.content).replace(/\n/g, "<br>")}</p></div>`
  ).join("");
  const locked = status === "final-ready" || status === "deck-ready" || status === "deck-building";
  const dl = downloads ? `<p class="dl"><a href="${escapeHtml(downloads.pdf)}">Download PDF</a> · <a href="${escapeHtml(downloads.docx)}">Download Word</a></p>` : "";
  const deckBtn = status === "final-ready" ? `<button data-act="deck">Generate presentation</button>` : "";
  const building = status === "deck-building" ? `<p class="muted">Building your presentation…</p>` : "";
  const deckPanel = deck ? `<p class="dl"><a href="${escapeHtml(deck.pptx)}">Download PowerPoint</a> · <a href="${escapeHtml(deck.view)}">Open browser deck</a></p>` : "";
  const controls = locked ? `${dl}${deckBtn}${building}${deckPanel}` : `
    <textarea id="msg" placeholder="Reply to mySensei, or steer the ${stage}..."></textarea>
    <p><button id="send">Send</button>
       <button data-act="regenerate">Regenerate ${stage}</button>
       <button data-act="lock">Lock the ${stage === "plan" ? "plan" : "paper"}</button></p>`;
  return `<!doctype html><html lang="${escapeHtml(languageCode)}" dir="${dir}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>mySensei — research</title>
<style>:root{--ink:#1d1b16;--muted:#6b6457;--bg:#faf8f3;--accent:#b4541f;--line:#e7e1d5;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,"Times New Roman",serif}
main{max-width:42rem;margin:0 auto;padding:2rem 1.25rem 4rem}
.doc{white-space:pre-wrap;background:#fff;border:1px solid var(--line);border-radius:.5rem;padding:1rem;font:15px/1.55 system-ui,sans-serif}
.m{margin:1rem 0}.m b{font:bold .8rem system-ui,sans-serif;color:var(--muted)}.m.me p{background:#fff;border:1px solid var(--line);border-radius:.5rem;padding:.6rem .8rem}
textarea{width:100%;min-height:5rem;font:inherit;padding:.6rem;border:1px solid var(--line);border-radius:.4rem}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:.4rem;padding:.6rem 1rem;cursor:pointer;margin:.4rem .4rem 0 0}
.dl a{color:var(--accent)}</style></head>
<body><main>
<h1>Your research ${stage === "plan" ? "plan" : "draft"}</h1>
${doc}
<section id="thread">${msgs}</section>
${controls}
<p id="err" style="color:var(--accent);display:none"></p>
<script id="meta" type="application/json">${meta}</script>
<script>(function(){
  var M=JSON.parse(document.getElementById("meta").textContent);
  var err=document.getElementById("err");
  function post(body){return fetch(M.webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){if(!r.ok)throw new Error();return r.json();});}
  var send=document.getElementById("send");
  if(send)send.addEventListener("click",function(){
    var t=document.getElementById("msg").value.trim(); if(!t)return;
    send.disabled=true;
    post({type:"dialogue",courseId:M.courseId,stage:M.stage,text:t}).then(function(){location.reload();})
      .catch(function(){err.textContent="Could not send — try again.";err.style.display="block";send.disabled=false;});
  });
  document.querySelectorAll("button[data-act]").forEach(function(b){
    b.addEventListener("click",function(){
      var act=b.getAttribute("data-act");
      if(act==="lock"&&!confirm("Lock this "+M.stage+"? mySensei will move to the next step."))return;
      b.disabled=true;
      post({type:act,courseId:M.courseId,stage:M.stage}).then(function(){location.reload();})
        .catch(function(){err.textContent="Could not "+act+" — try again.";err.style.display="block";b.disabled=false;});
    });
  });
})();</script>
</main></body></html>`;
}
