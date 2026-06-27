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
  const lockLabel = `Lock the ${stage === "plan" ? "plan" : "paper"}`;
  const sendDesc = `Sends your reply to mySensei to keep refining the ${stage}. Does nothing if the box is empty — type something first.`;
  const regenDesc = stage === "plan"
    ? "Rebuilds the written plan from this conversation. Your messages stay, but the current plan document is replaced. Takes about a minute."
    : "Rebuilds the draft from this conversation. Your messages stay, but the current draft is replaced. Takes about a minute.";
  const lockDesc = stage === "plan"
    ? "Ends the conversation and starts writing the full paper. You can't keep editing the plan by chat after this. Takes a minute or two."
    : "Locks the paper and builds the final downloadable version. Takes a minute or two.";
  const controls = locked ? `${dl}${deckBtn}${building}${deckPanel}` : `
    <textarea id="msg" placeholder="Reply to mySensei, or steer the ${stage}..."></textarea>
    <div class="actions">
      <div class="action"><button id="send" class="b-send">Send</button><span class="desc">${sendDesc}</span></div>
      <div class="action"><button data-act="regenerate" class="b-regen">Regenerate ${stage}</button><span class="desc">${regenDesc}</span></div>
      <div class="action"><button data-act="lock" class="b-lock">${lockLabel}</button><span class="desc">${lockDesc}</span></div>
    </div>`;
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
button:disabled{opacity:.55;cursor:default}
button.b-send{background:#1f6fb4}button.b-regen{background:#c0392b}button.b-lock{background:#2e7d4f}
.actions{margin-top:1rem}.action{margin:.85rem 0}
.action .desc{display:block;margin-top:.25rem;font:14px/1.45 system-ui,sans-serif;color:var(--muted);max-width:34rem}
#status{font:15px/1.5 system-ui,sans-serif;margin-top:.6rem;display:none}
.dl a{color:var(--accent)}</style></head>
<body><main>
<h1>Your research ${stage === "plan" ? "plan" : "draft"}</h1>
${doc}
<section id="thread">${msgs}</section>
${controls}
<p id="status"></p>
<script id="meta" type="application/json">${meta}</script>
<script>(function(){
  var M=JSON.parse(document.getElementById("meta").textContent);
  var status=document.getElementById("status");
  function setStatus(msg,kind){status.textContent=msg;status.style.display=msg?"block":"none";
    status.style.color=kind==="error"?"#c0392b":kind==="ok"?"#2e7d4f":"var(--muted)";}
  function post(body){return fetch(M.webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){if(!r.ok)throw new Error();return r.json();});}
  var send=document.getElementById("send");
  if(send)send.addEventListener("click",function(){
    var box=document.getElementById("msg"); var t=box.value.trim();
    if(!t){setStatus("Type a reply first, then press Send.","error");box.focus();return;}
    send.disabled=true; setStatus("Sending your reply…");
    post({type:"dialogue",courseId:M.courseId,stage:M.stage,text:t})
      .then(function(){setStatus("Sent. mySensei is thinking — this page will refresh shortly.","ok");setTimeout(function(){location.reload();},6000);})
      .catch(function(){setStatus("Could not send — please try again.","error");send.disabled=false;});
  });
  document.querySelectorAll("button[data-act]").forEach(function(b){
    b.addEventListener("click",function(){
      var act=b.getAttribute("data-act");
      var nextStep=M.stage==="plan"?"start writing the full paper":"build the final paper";
      if(act==="lock"&&!confirm("Lock this "+M.stage+"? This ends the conversation and mySensei will "+nextStep+". You can't keep editing the "+M.stage+" by chat after this."))return;
      if(act==="regenerate"&&!confirm("Rebuild the "+M.stage+" from this conversation? Your messages stay, but the current "+M.stage+" document is replaced."))return;
      b.disabled=true;
      var working=act==="lock"?"Locking the "+M.stage+" and starting the next step…":act==="regenerate"?"Rebuilding the "+M.stage+"…":"Working…";
      setStatus(working);
      post({type:act,courseId:M.courseId,stage:M.stage})
        .then(function(){setStatus("Started — mySensei is working in the background. This takes a minute or two; refresh the page to see the result.","ok");})
        .catch(function(){setStatus("Could not "+act+" — please try again.","error");b.disabled=false;});
    });
  });
})();</script>
</main></body></html>`;
}
