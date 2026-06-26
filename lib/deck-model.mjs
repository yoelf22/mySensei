import { registerDirective } from "./register.mjs";

export const DECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          point: { type: "string" },
          notes: { type: "string" },
        },
        required: ["heading", "point", "notes"],
      },
    },
  },
  required: ["slides"],
};

export function deckPrompt({ paperText, settings = {} }) {
  return (
    `Build a presentation deck in ${settings.language || "English"} from this research paper. ` +
    `${registerDirective(settings.educationLevel)} ` +
    `Produce a sequence of slides. Each slide has: a short heading; ONE main learning stated as the on-slide point ` +
    `(a single crisp line, not a paragraph); and presenter notes that carry the spoken narrative for that slide ` +
    `(2–5 sentences). Open with a title slide and close with a takeaways slide.\n\n` +
    `Paper:\n---\n${paperText}\n---`
  );
}
