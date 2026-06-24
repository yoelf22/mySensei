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
.allow li{padding:.3rem 0}</style></head><body>${body}</body></html>`;

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

export function dashboardPage() {
  return SHELL("mySensei — my courses", `<h1>My courses</h1><p><button id="new">Start a new course</button></p><div id="list" class="muted">Loading…</div>
<div id="invite" style="display:none"></div>
<script>
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});}
var IS_OWNER=false;
function openHref(c){
  var id=encodeURIComponent(c.id);
  if(c.status==="draft")return "/c/"+id+"/onboard";
  if(c.status==="awaiting-assessment")return "/c/"+id+"/assessment";
  if(c.status==="awaiting-approval")return "/c/"+id+"/syllabus";
  return "/c/"+id;
}
function loadInvite(){
  var box=document.getElementById("invite"); box.style.display="block";
  fetch("/api/allowlist").then(function(r){return r.ok?r.json():{emails:[]};}).then(function(d){
    var rows=(d.emails||[]).map(function(e){return '<li>'+esc(e)+' <button data-rm="'+esc(e)+'">remove</button></li>';}).join("");
    box.innerHTML='<h2>Invite</h2><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn">Invite</button></p><p id="invmsg" class="muted"></p><ul class="allow">'+rows+'</ul>';
  });
}
function renderInvitePanel(remaining){
  var box=document.getElementById("invite"); box.style.display="block";
  box.innerHTML='<h2>Invite</h2><p class="muted" id="invleft">'+esc(remaining)+' of 5 invites left</p><p><input id="invemail" type="email" placeholder="friend@example.com"> <button id="invbtn">Invite</button></p><p id="invmsg" class="muted"></p>';
}
function invite(){
  var em=document.getElementById("invemail").value, msg=document.getElementById("invmsg");
  fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){msg.textContent=(res.d&&res.d.error==="no invites left")?"You're out of invites.":"Could not invite (check the address).";return;}
      msg.textContent=res.d.already?(em+" is already invited."):("Invited "+em);
      if(IS_OWNER){loadInvite();}
      else{var left=document.getElementById("invleft");if(left&&res.d.remaining!=null){left.textContent=res.d.remaining+" of 5 invites left";}}
    });
}
function rmAllow(email){fetch("/api/allowlist/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})}).then(loadInvite);}
function share(id){
  var box=document.querySelector('[data-sb="'+id+'"]'); if(box) box.textContent="…";
  fetch("/api/courses/"+id+"/share",{method:"POST"}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.url){ if(box) box.textContent="(couldn't make a link)"; return; }
    if(box){ box.innerHTML='<input readonly value="'+esc(d.url)+'" style="width:100%">'; box.querySelector("input").select(); }
  });
}
function load(){fetch("/api/courses").then(function(r){if(r.status===401){location.href="/";return;}return r.json();}).then(function(d){
  if(!d)return; var el=document.getElementById("list");
  IS_OWNER=!!d.isOwner;
  if(d.isOwner) loadInvite(); else renderInvitePanel(d.inviteRemaining);
  if(!d.courses.length){el.textContent="No courses yet — start one.";return;}
  el.innerHTML=d.courses.map(function(c){
    var prog=c.progress?("module "+esc(c.progress.currentModule)):"";
    var btn="";
    if(c.status==="paused")btn='<button data-act="resume" data-id="'+esc(c.id)+'">Resume</button>';
    if(c.status==="active")btn='<button data-act="pause" data-id="'+esc(c.id)+'">Pause</button>';
    var badge=c.last_error?' <span class="badge">⚠ delayed</span>':'';
    var open='<a class="open" href="'+esc(openHref(c))+'">Open</a>';
    var shareBtn=c.subject?'<button data-share="'+esc(c.id)+'">Share</button> <span class="muted" data-sb="'+esc(c.id)+'"></span>':'';
    return '<div class="c"><b>'+esc(c.subject||"(new course)")+'</b>'+badge+'<div class="muted">'+esc(c.status)+" \xb7 level "+esc(c.level||"?")+" \xb7 "+prog+'</div><p>'+open+btn+shareBtn+'</p></div>';
  }).join("");
});}
function act(id,what){fetch("/api/courses/"+id+"/"+what,{method:"POST"}).then(function(r){if(r.status===409){alert("You're at your active-course limit — pause one first.");}load();});}
document.getElementById("list").addEventListener("click",function(e){
  var b=e.target.closest("button[data-act]");if(b){act(b.getAttribute("data-id"),b.getAttribute("data-act"));return;}
  var s=e.target.closest("button[data-share]");if(s){share(s.getAttribute("data-share"));}
});
document.getElementById("invite").addEventListener("click",function(e){
  if(e.target.id==="invbtn")invite();
  var rm=e.target.closest("button[data-rm]"); if(rm)rmAllow(rm.getAttribute("data-rm"));
});
document.getElementById("new").addEventListener("click",function(){fetch("/api/courses",{method:"POST"}).then(function(r){return r.json();}).then(function(d){location.href="/c/"+d.id+"/onboard";});});
load();
</script>`);
}
