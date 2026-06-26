// Thin shared helpers for the Claude API (used by the onboard / build / lesson
// scripts). Patterns follow the documented Sonnet 4.6 surface.

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.MYSENSEI_MODEL || "claude-sonnet-4-6";

export function client() {
  return new Anthropic(); // reads ANTHROPIC_API_KEY
}

export function textOf(message) {
  return (message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// Web-search a prompt; return the model's plain-text synthesis (handles the
// server-tool pause_turn loop).
export async function research(c, prompt) {
  let messages = [{ role: "user", content: prompt }];
  let out = "";
  for (let i = 0; i < 5; i++) {
    const r = await c.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages,
    });
    out += "\n" + textOf(r);
    if (r.stop_reason !== "pause_turn") break;
    messages = [{ role: "user", content: prompt }, { role: "assistant", content: r.content }];
  }
  return out.trim();
}

// Structured-output call: returns the validated JSON object.
export async function structured(c, prompt, schema, maxTokens = 4000) {
  const r = await c.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  return JSON.parse(textOf(r));
}

export const HEAVY_MODEL = process.env.MYSENSEI_HEAVY_MODEL || "claude-opus-4-8";

export function heavyClient() {
  return new Anthropic(); // reads ANTHROPIC_API_KEY; model chosen per-call
}

// Pull deduped {title,url} from a message's content blocks (web_search results
// and text-block citations). Pure; safe on partial/empty content.
export function extractSources(content) {
  const seen = new Set();
  const out = [];
  const add = (url, title) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ title: title || url, url });
  };
  for (const b of content || []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r && r.type === "web_search_result") add(r.url, r.title);
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const ci of b.citations) add(ci.url, ci.title);
    }
  }
  return out;
}

// research(), but also returns the real sources web search surfaced.
export async function researchWithSources(c, prompt, { model = MODEL } = {}) {
  let messages = [{ role: "user", content: prompt }];
  let text = "";
  const sources = [];
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const r = await c.messages.create({
      model, max_tokens: 8192,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages,
    });
    text += "\n" + textOf(r);
    for (const s of extractSources(r.content)) if (!seen.has(s.url)) { seen.add(s.url); sources.push(s); }
    if (r.stop_reason !== "pause_turn") break;
    messages = [{ role: "user", content: prompt }, { role: "assistant", content: r.content }];
  }
  return { text: text.trim(), sources };
}
