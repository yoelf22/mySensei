// Maps a learner's education level to a one-line writing-register directive that
// gets injected into the generation prompts (placement, syllabus, lessons).
// This is ORTHOGONAL to the 1-10 skill level: skill sets depth, this sets the
// prose register and how much jargon is assumed vs. defined.

const DIRECTIVES = {
  "middle-school":
    "Write for a curious middle-school reader: short sentences, everyday words, and define every specialized term in plain language the first time it appears.",
  "high-school":
    "Write for a high-school reader: clear, mostly everyday language; introduce any field-specific term with a brief plain-language definition.",
  "undergraduate":
    "Write at an undergraduate register: standard explanatory prose; introduce field terms with a one-line definition, and you may build on terms defined earlier.",
  "graduate":
    "Write at a graduate/professional register: assume field fluency, and use technical vocabulary freely and concisely without re-defining standard terms.",
};

/** A one-line writing directive for the given education level; defaults to undergraduate. */
export function registerDirective(educationLevel) {
  return DIRECTIVES[String(educationLevel || "").toLowerCase()] || DIRECTIVES.undergraduate;
}
