// worker/src/dispatch.mjs
export function buildDispatch(body) {
  const type = body.type || "quiz";
  const courseId = String(body.courseId || "");
  if (!courseId) return { error: "missing courseId" };

  if (type === "onboard") {
    if (!body.subject) return { error: "missing subject" };
    if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return { error: "missing or invalid email" };
    return { event_type: "onboard", client_payload: { courseId, subject: body.subject, email: body.email, angle: body.angle || "", language: body.language || "English", languageCode: body.languageCode || "en", chunkMinutes: Number(body.chunkMinutes) || 10, cadence: body.cadence === "weekly" ? "weekly" : "daily", deliveryTime: body.deliveryTime || "07:00", timezone: body.timezone || "UTC", workweekDays: Array.isArray(body.workweekDays) ? body.workweekDays : [0,1,2,3,4,5,6] } };
  }
  if (type === "assessment") {
    if (!Array.isArray(body.results) || !body.results.length) return { error: "missing results" };
    return { event_type: "assessment-result", client_payload: { courseId, results: body.results.map((r) => ({ level: Number(r.level), correct: !!r.correct })) } };
  }
  if (type === "approve") return { event_type: "syllabus-approved", client_payload: { courseId } };

  const module = Number(body.module), attempt = Number(body.attempt) || 1, score = Number(body.score), total = Number(body.total);
  if (![module, score, total].every(Number.isInteger) || total <= 0 || score < 0 || score > total) return { error: "invalid result" };
  return { event_type: "quiz-result", client_payload: { courseId, module, attempt, score, total, missed: Array.isArray(body.missed) ? body.missed.map(String).slice(0, 20) : [] } };
}
