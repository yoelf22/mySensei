// worker/src/pages.mjs
const SHELL = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:17px/1.6 Georgia,serif;background:#faf8f3;color:#1d1b16;max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem}
button{font:inherit;background:#b4541f;color:#fff;border:0;border-radius:.4rem;padding:.6rem 1.2rem;cursor:pointer}
input{font:inherit;padding:.6rem;border:1px solid #e7e1d5;border-radius:.4rem;width:100%}
.c{border:1px solid #e7e1d5;border-radius:.5rem;padding:1rem;margin:1rem 0;font-family:system-ui,sans-serif}
.muted{color:#6b6457;font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>`;

export function loginPage() {
  return SHELL("mySensei — sign in", `<h1>mySensei</h1><p class="muted">Enter your email; we'll send a sign-in link.</p>
<form id="f"><input type="email" name="email" required placeholder="you@example.com"><p><button>Send me a link</button></p><p id="m" class="muted"></p></form>
<script>document.getElementById("f").addEventListener("submit",function(e){e.preventDefault();var em=e.target.email.value;
fetch("/auth/request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})})
.then(function(){document.getElementById("m").textContent="If your email is on the list, a sign-in link is on its way.";});});</script>`);
}

export function dashboardPage() {
  return SHELL("mySensei — my courses", `<h1>My courses</h1><p><button id="new">Start a new course</button></p><div id="list" class="muted">Loading…</div>
<script>
function load(){fetch("/api/courses").then(function(r){if(r.status===401){location.href="/";return;}return r.json();}).then(function(d){
  if(!d)return; var el=document.getElementById("list");
  if(!d.courses.length){el.textContent="No courses yet — start one.";return;}
  el.innerHTML=d.courses.map(function(c){
    var prog=c.progress?("module "+c.progress.currentModule):"";
    return '<div class="c"><b>'+(c.subject||"(new course)")+'</b><div class="muted">'+c.status+" · level "+(c.level||"?")+" · "+prog+'</div>'+
      (c.status==="paused"?'<button onclick="act(\''+c.id+'\',\'resume\')">Resume</button>':'')+
      (c.status==="active"?'<button onclick="act(\''+c.id+'\',\'pause\')">Pause</button>':'')+'</div>';
  }).join("");
});}
function act(id,what){fetch("/api/courses/"+id+"/"+what,{method:"POST"}).then(function(r){if(r.status===409){alert("You're at your active-course limit — pause one first.");}load();});}
document.getElementById("new").addEventListener("click",function(){fetch("/api/courses",{method:"POST"}).then(function(r){return r.json();}).then(function(d){location.href="/c/"+d.id+"/onboard";});});
load();
</script>`);
}
