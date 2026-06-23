// Pure state-machine for mySensei progress. No I/O — easy to test.
// See docs/curriculum-schema.md for the field reference and rules.

/** Find the module object for a given id in the outline. */
export function moduleById(curriculum, id) {
  return (curriculum.outline || []).find((m) => m.id === id) || null;
}

/** The module + attempt the next lesson should cover. */
export function nextTarget(curriculum) {
  const id = curriculum.progress.currentModule;
  return {
    moduleId: id,
    attempt: curriculum.progress.attempt || 1,
    module: moduleById(curriculum, id),
  };
}

/** Did this quiz pass, given the curriculum's threshold? */
export function quizPassed(curriculum, score, total) {
  const threshold = curriculum.settings.passThreshold ?? 0.7;
  if (!total || total <= 0) return false;
  return score / total >= threshold;
}

/**
 * Apply a quiz result and return a NEW curriculum object.
 * A result is only honored if it matches the module + attempt currently in
 * progress — stale or replayed results are ignored (returns the input unchanged).
 *
 * result: { module, attempt, score, total, at }
 */
export function recordQuiz(curriculum, result) {
  const prog = curriculum.progress;
  const stale =
    result.module !== prog.currentModule ||
    (result.attempt ?? 1) !== (prog.attempt ?? 1);
  if (stale) return curriculum;

  const passed = quizPassed(curriculum, result.score, result.total);
  const mod = moduleById(curriculum, result.module);
  const next = structuredClone(curriculum);

  next.progress.lastQuiz = {
    module: result.module,
    attempt: result.attempt ?? 1,
    score: result.score,
    total: result.total,
    passed,
    missedConcepts: Array.isArray(result.missed) ? result.missed : [],
    at: result.at ?? null,
  };

  if (!passed) {
    // Re-teach the same module with different material next cadence.
    next.progress.attempt = (prog.attempt ?? 1) + 1;
    return next;
  }

  // Passed: raise mastery, advance.
  const targetLevel = mod?.targetLevel ?? next.level + 1;
  next.level = Math.min(10, Math.max(next.level, targetLevel));
  next.progress.currentModule = prog.currentModule + 1;
  next.progress.attempt = 1;

  if (next.level >= 10) {
    next.progress.status = "awaiting-specialization";
  }
  return next;
}

/**
 * Credit one disputed question on the most recent recorded quiz and re-evaluate.
 * Returns a NEW curriculum when it applies, the SAME object otherwise.
 *
 * Only the recorded `progress.lastQuiz` is amendable, and only when it matches
 * the disputed module+attempt and had not already passed — a dispute that lands
 * after the learner moved on (lastQuiz no longer matches) or on an already-passed
 * quiz is ignored, so we never pull the learner backward.
 *
 * amendment: { module, attempt, creditConcept }
 */
export function amendQuiz(curriculum, amendment) {
  const lq = curriculum.progress && curriculum.progress.lastQuiz;
  if (!lq) return curriculum;
  if (lq.module !== amendment.module || (lq.attempt ?? 1) !== (amendment.attempt ?? 1)) return curriculum;
  if (lq.passed) return curriculum;

  const newScore = Math.min(lq.total, lq.score + 1);
  const passed = quizPassed(curriculum, newScore, lq.total);
  const next = structuredClone(curriculum);
  next.progress.lastQuiz.score = newScore;
  next.progress.lastQuiz.passed = passed;
  if (Array.isArray(next.progress.lastQuiz.missedConcepts)) {
    next.progress.lastQuiz.missedConcepts = next.progress.lastQuiz.missedConcepts.filter(
      (c) => c !== amendment.creditConcept,
    );
  }
  if (!passed) return next;

  // Now passing: advance from the disputed module exactly like recordQuiz's pass.
  const mod = moduleById(curriculum, amendment.module);
  const targetLevel = mod?.targetLevel ?? next.level + 1;
  next.level = Math.min(10, Math.max(next.level, targetLevel));
  next.progress.currentModule = amendment.module + 1;
  next.progress.attempt = 1;
  if (next.level >= 10) next.progress.status = "awaiting-specialization";
  return next;
}

/** True once the learner has mastered the current track. */
export function atMastery(curriculum) {
  return curriculum.level >= 10 ||
    curriculum.progress.status === "awaiting-specialization";
}

/**
 * True when the current module id has run past the end of the outline but the
 * learner hasn't reached level 10 — the generator should extend the outline.
 */
export function needsMoreModules(curriculum) {
  if (atMastery(curriculum)) return false;
  const ids = (curriculum.outline || []).map((m) => m.id);
  const maxId = ids.length ? Math.max(...ids) : 0;
  return curriculum.progress.currentModule > maxId;
}

/**
 * True when the lesson for this target (module + attempt) has already been
 * delivered — used to make the cadence wait for the learner rather than
 * re-sending the same lesson. `target` is what nextTarget() returns.
 */
export function alreadyDelivered(curriculum, target) {
  const delivered = (curriculum.progress && curriculum.progress.delivered) || [];
  return delivered.some(
    (d) => d.module === target.moduleId && (d.attempt ?? 1) === (target.attempt ?? 1),
  );
}
