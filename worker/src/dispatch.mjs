// worker/src/dispatch.mjs
export function buildDispatch(body) {
  const type = body.type || "quiz";
  const courseId = String(body.courseId || "");
  if (!courseId) return { error: "missing courseId" };

  if (type === "onboard") {
    if (body.kind === "research") {
      if (!body.subject) return { error: "missing subject" };
      return { event_type: "plan-due", client_payload: { courseId, subject: body.subject, angle: body.angle || "", settings: { language: body.language || "English", languageCode: body.languageCode || "en", educationLevel: body.educationLevel || "undergraduate", domain: body.domain || "other" } } };
    }
    if (!body.subject) return { error: "missing subject" };
    // GitHub caps client_payload at 10 top-level properties, so the course
    // settings are nested under one `settings` key (keeps it to 4 top-level).
    return { event_type: "onboard", client_payload: { courseId, subject: body.subject, angle: body.angle || "", settings: { language: body.language || "English", languageCode: body.languageCode || "en", educationLevel: body.educationLevel || "undergraduate", domain: body.domain || "other", chunkMinutes: Number(body.chunkMinutes) || 10, cadence: body.cadence === "weekly" ? "weekly" : "daily", deliveryTime: body.deliveryTime || "07:00", timezone: body.timezone || "UTC", workweekDays: Array.isArray(body.workweekDays) ? body.workweekDays : [0,1,2,3,4,5,6] } } };
  }
  if (type === "assessment") {
    if (!Array.isArray(body.results) || !body.results.length) return { error: "missing results" };
    return { event_type: "assessment-result", client_payload: { courseId, results: body.results.map((r) => ({ level: Number(r.level), correct: !!r.correct })) } };
  }
  if (type === "approve") return { event_type: "syllabus-approved", client_payload: { courseId } };

  if (type === "adjust") {
    const direction = body.direction === "up" ? "up" : body.direction === "down" ? "down" : "";
    if (!direction) return { error: "invalid direction" };
    return { event_type: "syllabus-adjust", client_payload: { courseId, direction } };
  }

  const module = Number(body.module), attempt = Number(body.attempt) || 1, score = Number(body.score), total = Number(body.total);
  if (![module, score, total].every(Number.isInteger) || total <= 0 || score < 0 || score > total) return { error: "invalid result" };
  return { event_type: "quiz-result", client_payload: { courseId, module, attempt, score, total, missed: Array.isArray(body.missed) ? body.missed.map(String).slice(0, 20) : [] } };
}

const int = (v) => Number(v);

export function buildDisputeRecord(body) {
  const courseId = String(body.courseId || "");
  if (!courseId) return { error: "missing courseId" };
  const module = int(body.module), attempt = int(body.attempt) || 1, questionIndex = int(body.questionIndex);
  if (![module, questionIndex].every(Number.isInteger) || questionIndex < 0) return { error: "invalid module/questionIndex" };
  const reason = String(body.reason || "").trim();
  if (!reason) return { error: "missing reason" };
  if (!Array.isArray(body.options) || !body.options.length) return { error: "missing options" };
  if (!Number.isInteger(int(body.correctIndex))) return { error: "invalid correctIndex" };

  return {
    courseId, module, attempt, questionIndex,
    payload: {
      question: String(body.question || ""),
      options: body.options.map(String).slice(0, 10),
      correctIndex: int(body.correctIndex),
      chosenIndex: Number.isInteger(int(body.chosenIndex)) ? int(body.chosenIndex) : -1,
      concept: String(body.concept || ""),
      explanation: String(body.explanation || ""),
      reason: reason.slice(0, 2000),
    },
  };
}

export async function postDispatch(env, event_type, client_payload) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "mySensei-worker", "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, client_payload }),
  });
}
