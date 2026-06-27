import { escapeHtml, dirFor } from "./render-lesson.mjs";

export function renderProjectHtml({ courseId, webhookUrl, stage, status, document, thread = [], downloads = null, deck = null, languageCode = "en", ready = false }) {
  const dir = dirFor(languageCode);
  // Content fingerprint: changes whenever the stage, status, message count, or
  // document text changes. The page polls itself and reloads when this differs,
  // so a reply/result appears automatically once the background job re-renders.
  let h = 0; const sigText = document || ""; for (let i = 0; i < sigText.length; i++) h = (h * 31 + sigText.charCodeAt(i)) | 0;
  const sig = `${stage}:${status}:${thread.length}:${h}`;
  const meta = JSON.stringify({ webhook: webhookUrl, courseId, stage, status, sig });
  const doc = `<pre class="doc">${escapeHtml(document || "")}</pre>`;
  const msgs = thread.map((m) =>
    `<div class="m ${m.role === "user" ? "me" : "ms"}"><b>${m.role === "user" ? "You" : "mySensei"}</b><p>${escapeHtml(m.content).replace(/\n/g, "<br>")}</p></div>`
  ).join("");
  const locked = status === "final-ready" || status === "deck-ready" || status === "deck-building";
  const dl = downloads ? `<p class="dl"><a href="${escapeHtml(downloads.pdf)}">Download PDF</a> · <a href="${escapeHtml(downloads.docx)}">Download Word</a></p>` : "";
  const deckBtn = status === "final-ready" ? `<button data-act="deck">Generate presentation</button>` : "";
  const building = status === "deck-building" ? `<p class="muted">Building your presentation…</p>` : "";
  const deckPanel = deck ? `<p class="dl"><a href="${escapeHtml(deck.pptx)}">Download PowerPoint</a> · <a href="${escapeHtml(deck.view)}">Open browser deck</a></p>` : "";
  const noun = stage === "plan" ? "plan" : "paper";
  const lockLabel = `Lock the ${noun}`;
  const sendDesc = `Sends your reply to mySensei to keep refining the ${stage}. Does nothing if the box is empty — type something first.`;
  const regenDesc = stage === "plan"
    ? "Rebuilds the written plan from this conversation. Your messages stay, but the current plan document is replaced. Takes about a minute."
    : "Rebuilds the draft from this conversation. Your messages stay, but the current draft is replaced. Takes about a minute.";
  const lockDesc = stage === "plan"
    ? "Ends the conversation here. mySensei then writes the full paper in the background — this is not interactive, and you'll get an email when the draft is ready to review. You can't keep editing the plan by chat after this."
    : "Ends the conversation here. mySensei then builds the final paper and downloads in the background — you'll get an email when they're ready. You can't keep editing by chat after this.";
  const lockHint = ready
    ? `<p class="lockhint ok">✓ mySensei thinks this ${noun} is solid enough to finish — lock it when you're ready, or keep refining.</p>`
    : `<p class="lockhint">mySensei will enable Lock once it judges the ${noun} solid enough. Keep refining with Send.</p>`;
  const controlsInner = locked ? `${dl}${deckBtn}${building}${deckPanel}` : `
    <textarea id="msg" placeholder="Reply to mySensei, or steer the ${stage}..."></textarea>
    <div class="actions">
      <div class="action"><button id="send" class="b-send">Send</button><span class="desc">${sendDesc}</span></div>
      <div class="action"><button data-act="regenerate" class="b-regen">Regenerate ${stage}</button><span class="desc">${regenDesc}</span></div>
      <div class="action lockgate">
        ${lockHint}
        <button data-act="lock" id="lockbtn" class="b-lock" data-ready="${ready ? "1" : "0"}"${ready ? "" : " disabled"}>${lockLabel}</button>
        <span class="desc">${lockDesc}</span>
      </div>
    </div>`;
  const controls = `<div id="ctl">${controlsInner}</div>`;
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
.lockgate{border-top:1px solid var(--line);margin-top:1.2rem;padding-top:1rem}
.lockhint{font:14px/1.45 system-ui,sans-serif;color:var(--muted);margin:0 0 .5rem}
.lockhint.ok{color:#2e7d4f;font-weight:600}
.endpanel{background:#fff;border:1px solid var(--line);border-inline-start:4px solid #2e7d4f;border-radius:.5rem;padding:1rem 1.1rem;font:15px/1.55 system-ui,sans-serif}
.endpanel b{color:#2e7d4f}
#toast{position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:.5rem;align-items:center;pointer-events:none}
.toast{pointer-events:auto;background:#2b2f3a;color:#fff;font:15px/1.4 system-ui,sans-serif;padding:.7rem 1.05rem;border-radius:.5rem;box-shadow:0 6px 20px rgba(0,0,0,.22);max-width:90vw;text-align:center;opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s}
.toast.show{opacity:1;transform:translateY(0)}
.toast.ok{background:#2e7d4f}.toast.error{background:#c0392b}
.toast .spin{display:inline-block;width:.8em;height:.8em;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;margin-inline-end:.5rem;vertical-align:-.1em;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.dl a{color:var(--accent)}</style></head>
<body><main>
<div id="content"><h1>Your research ${stage === "plan" ? "plan" : "draft"}</h1>
${doc}
<section id="thread">${msgs}</section>
${controls}</div>
</main>
<div id="toast"></div>
<script id="meta" type="application/json">${meta}</script>
<script>(function(){
  var M=JSON.parse(document.getElementById("meta").textContent);
  var box=document.getElementById("toast");
  function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}
  function toast(msg,kind,opt){opt=opt||{};var el=document.createElement("div");el.className="toast "+(kind||"");
    el.innerHTML=(opt.spin?'<span class="spin"></span>':"")+esc(msg);box.appendChild(el);
    requestAnimationFrame(function(){el.classList.add("show");});
    if(!opt.sticky)setTimeout(function(){hide(el);},opt.ms||4000);return el;}
  function hide(el){if(!el)return;el.classList.remove("show");setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},250);}
  function post(body){return fetch(M.webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){if(!r.ok)throw new Error();return r.json();});}
  // No full reload: poll this page until its content fingerprint changes (the
  // background job re-rendered), then swap just the #content region in place and
  // re-bind the controls, so the new reply/result animates in smoothly.
  var watching=false;
  function watch(){if(watching)return;watching=true;var tries=0,max=75;
    (function loop(){setTimeout(function(){tries++;
      fetch(location.href,{cache:"no-store"}).then(function(r){return r.text();}).then(function(html){
        var nd=new DOMParser().parseFromString(html,"text/html");
        var mEl=nd.getElementById("meta");var nm=null;if(mEl){try{nm=JSON.parse(mEl.textContent);}catch(e){}}
        var nc=nd.getElementById("content");
        if(nm&&nc&&String(nm.sig)!==String(M.sig)){
          watching=false;
          document.getElementById("content").innerHTML=nc.innerHTML;
          M.sig=nm.sig;M.stage=nm.stage;M.status=nm.status;
          wire();
          toast("Updated","ok");
          var th=document.getElementById("thread");
          if(th&&th.lastElementChild)th.lastElementChild.scrollIntoView({behavior:"smooth",block:"center"});
          return;
        }
        if(tries<max)loop();else{watching=false;toast("Still working - this is taking a while. It'll update on its own when it's ready.","ok",{ms:9000});}
      }).catch(function(){if(tries<max)loop();else watching=false;});
    },4000);})();}
  // Once any action is in flight, freeze all inputs so it's clear no further
  // input is accepted until it resolves. When unfrozen, the Lock button stays
  // gated behind its "ready" checkbox.
  function setBusy(on){
    var ctl=document.getElementById("ctl");if(!ctl)return;
    ctl.querySelectorAll("button,textarea,input").forEach(function(el){el.disabled=on;});
    if(!on){var lk=document.getElementById("lockbtn");if(lk)lk.disabled=lk.getAttribute("data-ready")!=="1";}
  }
  function onSend(){
    var t=document.getElementById("msg");var v=t.value.trim();
    if(!v){toast("Type a reply first, then press Send.","error");t.focus();return;}
    setBusy(true);
    var w=toast("Sending your reply...","",{sticky:true,spin:true});
    post({type:"dialogue",courseId:M.courseId,stage:M.stage,text:v}).then(function(){
      hide(w);toast("Sent. No more input needed for now - mySensei is thinking, and the reply will appear here in a moment.","",{spin:true,ms:6000});watch();
    }).catch(function(){hide(w);toast("Could not send - please try again.","error");setBusy(false);});
  }
  function onAct(){
    var b=this;var act=b.getAttribute("data-act");
    var noun=M.stage==="plan"?"plan":"paper";
    if(act==="lock"&&!confirm("Lock the "+noun+"? This ends the conversation. mySensei will write the full "+(M.stage==="plan"?"paper":"final paper")+" in the background and email you when it's ready - you can't keep editing by chat after this."))return;
    if(act==="regenerate"&&!confirm("Rebuild the "+M.stage+" from this conversation? Your messages stay, but the current "+M.stage+" document is replaced."))return;
    setBusy(true);
    if(act==="lock"){
      toast("Locked. mySensei is now writing your "+(M.stage==="plan"?"paper":"final paper")+" in the background - this is not interactive. We'll email you when it's ready.","ok",{ms:11000});
      post({type:act,courseId:M.courseId,stage:M.stage}).then(function(){
        var ctl=document.getElementById("ctl");
        if(ctl)ctl.innerHTML='<div class=endpanel><b>'+(M.stage==="plan"?"Plan":"Paper")+' locked.</b> mySensei is now writing your '+(M.stage==="plan"?"full paper":"final paper")+' in the background. This takes a few minutes and is not interactive, so no more input is needed here. <b>You will get an email when it is ready to review - it is safe to close this page now.</b></div>';
        watch();
      }).catch(function(){toast("Could not lock - please try again.","error");setBusy(false);});
      return;
    }
    var label=act==="regenerate"?"Rebuilding the "+M.stage+"...":"Working...";
    var w=toast(label,"",{sticky:true,spin:true});
    post({type:act,courseId:M.courseId,stage:M.stage}).then(function(){
      hide(w);toast("Started. No more input needed - this page will update on its own when it's ready.","",{spin:true,ms:6000});watch();
    }).catch(function(){hide(w);toast("Could not "+act+" - please try again.","error");setBusy(false);});
  }
  function wire(){
    var s=document.getElementById("send");if(s)s.addEventListener("click",onSend);
    document.querySelectorAll("button[data-act]").forEach(function(b){b.addEventListener("click",onAct);});
  }
  wire();
})();</script>
</body></html>`;
}
