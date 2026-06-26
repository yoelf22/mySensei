import { escapeHtml } from "./render-lesson.mjs";

export function renderDeckHtml({ slides = [], courseId = "", languageCode = "en" }) {
  const data = JSON.stringify(slides.map((s) => ({ heading: s.heading || "", point: s.point || "", notes: s.notes || "" })))
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\//g, "\\u002f");
  const slideEls = slides.map((s, i) =>
    `<section class="slide${i === 0 ? " on" : ""}"><h2>${escapeHtml(s.heading || "")}</h2><p class="point">${escapeHtml(s.point || "")}</p>` +
    `<aside class="notes">${escapeHtml(s.notes || "")}</aside></section>`
  ).join("");
  return `<!doctype html><html lang="${escapeHtml(languageCode)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>mySensei — deck</title>
<style>:root{--ink:#1d1b16;--muted:#6b6457;--bg:#faf8f3;--accent:#b4541f;--line:#e7e1d5;}
*{box-sizing:border-box}body{margin:0;background:#111;color:#fff;font:18px/1.5 system-ui,sans-serif;height:100vh;overflow:hidden}
.slide{display:none;height:100vh;padding:6vh 8vw;flex-direction:column;justify-content:center}
.slide.on{display:flex}.slide h2{font-size:2.4rem;margin:0 0 1rem;color:#fff}
.point{font-size:1.6rem;color:#f3ead8}
.notes{display:none;margin-top:auto;padding:1rem;background:#000;color:#cbb;font-size:1rem;border-top:1px solid #333}
body.notes-on .slide.on .notes{display:block}
.bar{position:fixed;bottom:8px;left:0;right:0;text-align:center;color:#888;font-size:.8rem}
.bar b{color:#fff}</style></head>
<body><div id="deck">${slideEls}</div>
<div class="bar"><span id="pos"></span> · ← → to move · <b>N</b> notes</div>
<script id="deckdata" type="application/json">${data}</script>
<script>(function(){
  var slides=[].slice.call(document.querySelectorAll(".slide")); var i=0;
  var pos=document.getElementById("pos");
  function show(n){ slides[i].classList.remove("on"); i=Math.max(0,Math.min(slides.length-1,n)); slides[i].classList.add("on"); pos.textContent=(i+1)+" / "+slides.length; }
  document.addEventListener("keydown",function(e){
    if(e.key==="ArrowRight"||e.key===" ") show(i+1);
    else if(e.key==="ArrowLeft") show(i-1);
    else if(e.key==="n"||e.key==="N") document.body.classList.toggle("notes-on");
  });
  show(0);
})();</script></body></html>`;
}
