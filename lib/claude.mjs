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
