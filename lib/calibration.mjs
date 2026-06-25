// Closed lists + level-band helpers for course calibration. Pure, no I/O.

export const DOMAINS = [
  { slug: "social-sciences", label: "Social sciences" },
  { slug: "exact-sciences", label: "Exact & natural sciences (math, physics, chemistry, biology)" },
  { slug: "engineering", label: "Engineering & technology (incl. computer science)" },
  { slug: "arts-humanities", label: "Arts & humanities" },
  { slug: "business-professional", label: "Business & professional" },
  { slug: "health-medicine", label: "Health & medicine" },
  { slug: "other", label: "Other" },
];

export const LEVEL_BANDS = [
  { label: "General audience", min: 1, max: 2, level: 2 },
  { label: "Undergraduate (intro)", min: 3, max: 4, level: 4 },
  { label: "Undergraduate (advanced)", min: 5, max: 6, level: 6 },
  { label: "Graduate", min: 7, max: 8, level: 8 },
  { label: "Expert / research", min: 9, max: 10, level: 10 },
];

function clampLevel(n) { return Math.max(1, Math.min(10, Math.round(Number(n) || 1))); }

export function levelBandIndex(level) {
  const L = clampLevel(level);
  const i = LEVEL_BANDS.findIndex((b) => L >= b.min && L <= b.max);
  return i < 0 ? 0 : i;
}

export function levelBandLabel(level) {
  return LEVEL_BANDS[levelBandIndex(level)].label;
}

export function adjustLevel(level, direction) {
  const step = direction === "up" ? 1 : direction === "down" ? -1 : 0;
  const j = Math.max(0, Math.min(LEVEL_BANDS.length - 1, levelBandIndex(level) + step));
  return LEVEL_BANDS[j].level;
}

export function domainLabel(slug) {
  const d = DOMAINS.find((x) => x.slug === slug);
  return (d || DOMAINS.find((x) => x.slug === "other")).label;
}
