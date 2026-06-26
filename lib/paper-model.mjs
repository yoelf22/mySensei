import { registerDirective } from "./register.mjs";

export const PAPER_OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    abstract: { type: "string" },
    headings: { type: "array", items: { type: "string" } },
    conclusionHint: { type: "string" },
  },
  required: ["title", "headings"],
};

export function outlinePrompt({ planText, settings = {} }) {
  return (
    `You are outlining a research paper in ${settings.language || "English"}. ${registerDirective(settings.educationLevel)} ` +
    `Following this locked plan, produce: a precise title, a subtitle, a ~150-word abstract, an ordered list of section headings ` +
    `(the body of the paper), and a one-line hint for the conclusion. Do NOT write the sections yet — just the outline.\n\n` +
    `Locked plan:\n---\n${planText}\n---`
  );
}

export function sectionPrompt({ subject, settings = {}, planText, heading, priorText = "" }) {
  return (
    `You are writing ONE section of a research paper in ${settings.language || "English"} on "${subject}". ` +
    `${registerDirective(settings.educationLevel)} Write the section titled "${heading}". ` +
    `Be rigorous and specific; cite real, current sources via web search. Stay consistent with the plan and with what has already been written; ` +
    `do not repeat earlier sections. Return only the prose for this section (no heading line).\n\n` +
    `Plan:\n---\n${planText}\n---\n` +
    (priorText ? `What has been written so far:\n---\n${priorText}\n---\n` : "")
  );
}

export function conclusionPrompt({ subject, settings = {}, planText, bodyText = "" }) {
  return (
    `Write the conclusion (in ${settings.language || "English"}) of a research paper on "${subject}". ` +
    `${registerDirective(settings.educationLevel)} Synthesize the argument, state what the evidence supports, and note limits. ` +
    `Return only the conclusion prose.\n\nPlan:\n---\n${planText}\n---\nBody so far:\n---\n${bodyText}\n---`
  );
}

export function renderReferences(references = []) {
  return (references || []).map((r, i) => `[${i + 1}] ${r.title || r.url} — ${r.url}`).join("\n");
}

export function paperToText(paper, references = []) {
  const sections = (paper.sections || []).map((s) => `${s.heading}\n\n${s.body}`).join("\n\n");
  const refs = renderReferences(references);
  return [
    paper.title || "",
    paper.subtitle || "",
    paper.abstract ? `Abstract\n\n${paper.abstract}` : "",
    sections,
    paper.conclusion ? `Conclusion\n\n${paper.conclusion}` : "",
    refs ? `References\n\n${refs}` : "References\n\n(none)",
  ].filter(Boolean).join("\n\n");
}
