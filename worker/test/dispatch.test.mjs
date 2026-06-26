import { describe, it, expect } from "vitest";
import { buildDispatch } from "../src/dispatch.mjs";

describe("buildDispatch research", () => {
  it("research onboard → plan-due, no scheduling", () => {
    const d = buildDispatch({ type: "onboard", kind: "research", courseId: "abc", subject: "Tariffs and inflation", angle: "US 2025", language: "English", languageCode: "en", educationLevel: "graduate", domain: "economics", cadence: "daily", chunkMinutes: 10 });
    expect(d.event_type).toBe("plan-due");
    expect(d.client_payload.settings.educationLevel).toBe("graduate");
    expect(d.client_payload.settings.cadence).toBeUndefined();
  });
  it("course onboard still maps to onboard event", () => {
    const d = buildDispatch({ type: "onboard", kind: "course", courseId: "abc", subject: "X" });
    expect(d.event_type).toBe("onboard");
  });
});
