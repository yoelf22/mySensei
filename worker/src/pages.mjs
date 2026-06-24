// worker/src/pages.mjs
const SHELL = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:17px/1.6 Georgia,serif;background:#faf8f3;color:#1d1b16;max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem}
button{font:inherit;background:#b4541f;color:#fff;border:0;border-radius:.4rem;padding:.6rem 1.2rem;cursor:pointer}
input{font:inherit;padding:.6rem;border:1px solid #e7e1d5;border-radius:.4rem;width:100%}
.c{border:1px solid #e7e1d5;border-radius:.5rem;padding:1rem;margin:1rem 0;font-family:system-ui,sans-serif}
.muted{color:#6b6457;font-family:system-ui,sans-serif}
a.open{display:inline-block;margin-inline-end:.7rem;color:#b4541f;font-family:system-ui,sans-serif;font-weight:bold;text-decoration:none}
.badge{font-family:system-ui,sans-serif;font-size:.75rem;color:#fff;background:#b4541f;border-radius:.3rem;padding:.05rem .4rem}
#invite{border-top:1px solid #e7e1d5;margin-top:2rem;padding-top:1rem}
.allow{list-style:none;padding:0;font-family:system-ui,sans-serif;font-size:.9rem}
.allow li{padding:.3rem 0;display:flex;justify-content:space-between;align-items:center}
input[type=checkbox]{width:auto}
.tbl{border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:.9rem;margin-top:1rem}
.tbl th,.tbl td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #e7e1d5}
.tbl th{color:#6b6457;font-weight:600}
.blue{background:#1f6fb4}
.danger{background:#c0392b}
.actions{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-top:.6rem}
.share-group{margin-inline-start:.6rem;padding-inline-start:.7rem;border-inline-start:1px solid #e7e1d5}</style></head><body>${body}</body></html>`;

export function loginPage() {
  return SHELL("mySensei — sign in", `<h1>mySensei</h1><p class="muted">Enter your email; we'll send a sign-in link.</p>
<form id="f"><input type="email" name="email" required placeholder="you@example.com"><p><button>Send me a link</button></p><p id="m" class="muted"></p></form>
<script>document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var em=e.target.email.value;
fetch("/auth/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
.then(function(){document.getElementById("m").textContent="If your email is on the list, a sign-in link is on its way.";});});</script>`);
}

export function verifyPage(token) {
  // Scanner-safe sign-in: email link-scanners follow the GET link but don't
  // submit POST forms, so the single-use token is consumed only when the human
  // clicks this button — not when a scanner pre-fetches the link.
  const t = String(token || "").replace(/[^a-z0-9]/gi, "");
  return SHELL("mySensei — sign in", `<h1>Sign in to mySensei</h1>
<p class="muted">One more tap to finish signing in.</p>
<form method="POST" action="/auth/verify"><input type="hidden" name="token" value="${t}"><p><button type="submit">Sign in</button></p></form>`);
}

export function sharePage(subject, token) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  return SHELL("mySensei — start a shared course", `<h1>Learn ${esc(subject)}</h1>
<p class="muted">Someone shared this course with you. Enter your email and we'll send a sign-in link to start your own copy.</p>
<form id="f"><input type="email" name="email" required placeholder="you@example.com"><p><button>Send me a link</button></p><p id="m" class="muted"></p></form>
<script>
var TOKEN=${JSON.stringify(token)};
document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var em=e.target.email.value;
fetch("/auth/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em,shareToken:TOKEN})})
.then(function(){document.getElementById("m").textContent="Check your email for a sign-in link to start the course.";});});
</script>`);
}

export function shareUnavailablePage() {
  return SHELL("mySensei", `<h1>Link unavailable</h1><p class="muted">This share link is no longer available — it may have expired or reached its limit.</p>`);
}

export function adminLoginPage(error) {
  return SHELL("mySensei — admin sign in", `<h1>Admin sign in</h1>
${error ? '<p class="muted" style="color:#b4541f">Wrong username or password.</p>' : ""}
<form method="POST" action="/admin/login">
<p><input type="text" name="username" placeholder="username" autocomplete="username" required></p>
<p><input type="password" name="password" placeholder="password" autocomplete="current-password" required></p>
<p><button type="submit">Sign in</button></p>
</form>`);
}

export function adminPage() {
  return SHELL("mySensei — admin", `<h1>Admin</h1>
<p><a class="open" href="/dashboard">← My courses</a></p>
<div id="stats" class="muted">Loading…</div>
<div id="users"></div>
<script>
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
function chart(series){
  if(!series.length) return "";
  var W=640,H=220,P=34;
  var xs=series.map(function(p){return Date.parse(p.date);});
  var minx=Math.min.apply(null,xs), maxx=Math.max.apply(null,xs);
  var maxy=Math.max.apply(null,series.map(function(p){return p.total;}));
  function X(t){return maxx===minx?(W/2):(P+(W-2*P)*(t-minx)/(maxx-minx));}
  function Y(v){return maxy===0?(H-P):(H-P-(H-2*P)*v/maxy);}
  var pts=series.map(function(p){return X(Date.parse(p.date)).toFixed(1)+","+Y(p.total).toFixed(1);}).join(" ");
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Total courses started over time">'
    +'<line x1="'+P+'" y1="'+(H-P)+'" x2="'+(W-P)+'" y2="'+(H-P)+'" stroke="#e7e1d5"/>'
    +'<polyline fill="none" stroke="#b4541f" stroke-width="2" points="'+pts+'"/>'
    +'<text x="'+P+'" y="'+(H-10)+'" font-size="11" fill="#6b6457">'+esc(series[0].date)+'</text>'
    +'<text x="'+(W-P)+'" y="'+(H-10)+'" font-size="11" fill="#6b6457" text-anchor="end">'+esc(series[series.length-1].date)+'</text>'
    +'<text x="'+P+'" y="'+(P-12)+'" font-size="11" fill="#6b6457">'+maxy+' total</text>'
    +'</svg>';
}
function render(d){
  var s=document.getElementById("stats"); s.className="";
  if(!d.courses.length){s.innerHTML="<p>No courses started yet.</p>";return;}
  var sum=d.summary;
  var rows=d.courses.map(function(c){
    return '<tr><td>'+esc(c.topic)+'</td><td>'+esc(c.status)+'</td><td>'+esc((c.startedAt||"").slice(0,10))+'</td><td>'+esc(c.lessons)+'</td></tr>';
  }).join("");
  s.innerHTML=chart(d.series)
    +'<p class="muted">'+sum.started+' started \xb7 '+sum.active+' active \xb7 '+sum.paused+' paused \xb7 '+sum.done+' done</p>'
    +'<table class="tbl"><thead><tr><th>Topic</th><th>Status</th><th>Started</th><th>Lessons</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function loadStats(){
  fetch("/api/admin/stats").then(function(r){if(r.status===401||r.status===403){location.href="/admin/login";return;}return r.json();})
    .then(function(d){if(d)render(d);})
    .catch(function(){document.getElementById("stats").textContent="Couldn't load stats.";});
}
function loadInvite(){
  var box=document.getElementById("users");
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li><span>'+esc(e)+'</span><input type="checkbox" class="usel" value="'+esc(e)+'"></li>';}).join("");
    box.innerHTML='<h2>Users</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul><p><button id="rmsel">Remove selected</button></p>';
  });
}
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){msg.textContent="Could not invite (check the address).";return;}
      msg.textContent=res.d.already?(em+" is already invited."):("Invited "+em);
      loadInvite();
    });
}
function removeSelected(){
  var boxes=document.querySelectorAll("input.usel:checked");
  if(!boxes.length) return;
  if(!confirm("Remove "+boxes.length+" user(s)?")) return;
  var emails=[]; for(var i=0;i<boxes.length;i++) emails.push(boxes[i].value);
  Promise.all(emails.map(function(em){
    return fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})});
  })).then(loadInvite, loadInvite);
}
document.getElementById("users").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  if(e.target.id==="rmsel")removeSelected();
});
loadStats(); loadInvite();
</script>`);
}

export function dashboardPage() {
  return SHELL("mySensei — my courses", `<h1>My courses</h1><p><a id="adminlink" class="open" href="/admin" style="display:none">Admin</a></p><p><button id="new">Start a new course</button></p><div id="list" class="muted">Loading…</div>
<div id="invite" style="display:none"></div>
<script>
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
function openHref(c){
  var id=encodeURIComponent(c.id);
  if(c.status==="draft")return "/c/"+id+"/onboard";
  if(c.status==="awaiting-assessment")return "/c/"+id+"/assessment";
  if(c.status==="awaiting-approval")return "/c/"+id+"/syllabus";
  return "/c/"+id;
}
function renderInvitePanel(remaining){
  var box=document.getElementById("invite"); box.style.display="block";
  box.innerHTML='<h2>Invite</h2><p class="muted" id="invleft">'+esc(remaining)+' of 5 invites left</p><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn" class="blue">Invite</button></p><p id="invmsg" class="muted"></p>';
}
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){msg.textContent=(res.d&&res.d.error==="no invites left")?"You're out of invites.":"Could not invite (check the address).";return;}
      msg.textContent=res.d.already?(em+" is already invited."):("Invited "+em);
      var left=document.getElementById("invleft");if(left&&res.d.remaining!=null){left.textContent=res.d.remaining+" of 5 invites left";}
    });
}
function share(id){
  var box=document.querySelector('[data-sb="'+id+'"]'); if(box) box.textContent="…";
  fetch("/api/courses/"+id+"/share",{method:"POST"}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.url){ if(box) box.textContent="(couldn't make a link)"; return; }
    if(box){ box.innerHTML='<input readonly value="'+esc(d.url)+'" style="width:100%">'; box.querySelector("input").select(); }
  });
}
function load(){fetch("/api/courses").then(function(r){if(r.status===401){location.href="/";return;}return r.json();}).then(function(d){
  if(!d)return; var el=document.getElementById("list");
  if(d.isOwner){var a=document.getElementById("adminlink");if(a)a.style.display="inline";}
  else renderInvitePanel(d.inviteRemaining);
  if(!d.courses.length){el.textContent="No courses yet — start one.";return;}
  el.innerHTML=d.courses.map(function(c){
    var prog=c.progress?("module "+esc(c.progress.currentModule)):"";
    var btn="";
    if(c.status==="paused")btn='<button data-act="resume" data-id="'+esc(c.id)+'">Resume</button>';
    if(c.status==="active")btn='<button class="danger" data-act="pause" data-id="'+esc(c.id)+'">Pause</button>';
    var badge=c.last_error?' <span class="badge">⚠ delayed</span>':'';
    var open='<a class="open" href="'+esc(openHref(c))+'">Open</a>';
    var shareBtn=c.subject?'<span class="share-group"><button data-share="'+esc(c.id)+'">Share</button> <span class="muted" data-sb="'+esc(c.id)+'"></span></span>':'';
    return '<div class="c"><b>'+esc(c.subject||"(new course)")+'</b>'+badge+'<div class="muted">'+esc(c.status)+" \xb7 level "+esc(c.level||"?")+" \xb7 "+prog+'</div><p class="actions">'+open+btn+shareBtn+'</p></div>';
  }).join("");
});}
function act(id,what){
  if(what==="pause" && !confirm("Pause this course? Lessons stop until you resume.")) return;
  fetch("/api/courses/"+id+"/"+what,{method:"POST"}).then(function(r){if(r.status===409){alert("You're at your active-course limit — pause one first.");}load();});
}
document.getElementById("list").addEventListener("click",function(e){
  var b=e.target.closest("button[data-act]");if(b){act(b.getAttribute("data-id"),b.getAttribute("data-act"));return;}
  var s=e.target.closest("button[data-share]");if(s){share(s.getAttribute("data-share"));}
});
document.getElementById("invite").addEventListener("click",function(e){ if(e.target.id==="invbtn")invite(); });
document.getElementById("new").addEventListener("click",function(){fetch("/api/courses",{method:"POST"}).then(function(r){return r.json();}).then(function(d){location.href="/c/"+d.id+"/onboard";});});
load();
</script>`);
}
