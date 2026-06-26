import { registerDirective } from "./register.mjs";

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    thesis: { type: "string" },
    influences: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: { type: "string" } },
    approach: {
      type: "object",
      additionalProperties: false,
      properties: {
        initialConclusion: { type: "string" },
        researchMethod: { type: "string" },
        confirmationCriteria: { type: "string" },
        fallbacks: { type: "string" },
      },
      required: ["initialConclusion", "researchMethod", "confirmationCriteria", "fallbacks"],
    },
  },
  required: ["thesis", "influences", "sources", "approach"],
};

export function planPrompt({ subject, angle, settings = {}, thread = [], notes = "" }) {
  const convo = thread.length
    ? `\n\nThe author and you have discussed this. REVISE the plan to reflect the conversation:\n` +
      thread.map((m) => `${m.role === "user" ? "Author" : "You"}: ${m.content}`).join("\n")
    : "";
  return (
    `You are planning a research paper in ${settings.language || "English"} on: "${subject}"` +
    `${angle ? ` (angle: ${angle})` : ""}. ${registerDirective(settings.educationLevel)} ` +
    `Produce a research PLAN with: a sharp thesis; the factors that influence it; where to look for credible sources; ` +
    `and an approach (how you'll reach an initial conclusion, how you'll research it, what criteria confirm it, and fallbacks if it doesn't hold). ` +
    `Ground it in current reality.${notes ? `\n\nResearch notes:\n${notes}` : ""}${convo}`
  );
}

export function planToText(plan) {
  const a = plan.approach || {};
  return [
    `THESIS\n${plan.thesis || ""}`,
    `WHAT INFLUENCES IT\n${(plan.influences || []).map((x) => `• ${x}`).join("\n")}`,
    `WHERE TO LOOK FOR SOURCES\n${(plan.sources || []).map((x) => `• ${x}`).join("\n")}`,
    `APPROACH`,
    `Initial conclusion: ${a.initialConclusion || ""}`,
    `How to research: ${a.researchMethod || ""}`,
    `What confirms it: ${a.confirmationCriteria || ""}`,
    `Fallbacks: ${a.fallbacks || ""}`,
  ].join("\n\n");
}
