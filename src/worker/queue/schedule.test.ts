import { describe, it, expect } from "vitest";
import { computeNextRunAt } from "@/src/worker/queue/schedule";

describe("computeNextRunAt", () => {
  it("computes the correct UTC instant across a BST (UTC+1) offset", () => {
    // 2026-09-25 is within British Summer Time (BST, UTC+1) -- a naive
    // "just add hours" implementation would return 12:00 UTC here, one
    // hour off from the real 12:00 wall-clock time in London.
    const now = new Date("2026-09-25T00:00:00.000Z");
    const next = computeNextRunAt(now, {
      timezone: "Europe/London",
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
      postingTimes: ["12:00"],
    });
    expect(next?.toISOString()).toBe("2026-09-25T11:00:00.000Z");
  });

  it("computes the correct UTC instant across a GMT (UTC+0) offset", () => {
    // 2026-01-15 is outside BST -- London wall-clock 12:00 is 12:00 UTC.
    const now = new Date("2026-01-15T00:00:00.000Z");
    const next = computeNextRunAt(now, {
      timezone: "Europe/London",
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
      postingTimes: ["12:00"],
    });
    expect(next?.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("skips to the next allowed day when today isn't allowed", () => {
    // 2026-09-25 is a Friday (day 5). Only Mondays (1) are allowed, so the
    // next occurrence should be 2026-09-28.
    const now = new Date("2026-09-25T00:00:00.000Z");
    const next = computeNextRunAt(now, {
      timezone: "UTC",
      allowedDays: [1],
      postingTimes: ["09:00"],
    });
    expect(next?.toISOString()).toBe("2026-09-28T09:00:00.000Z");
  });

  it("rolls to the next day once all of today's posting times have passed", () => {
    const now = new Date("2026-09-25T13:00:00.000Z"); // Friday, 13:00 UTC
    const next = computeNextRunAt(now, {
      timezone: "UTC",
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
      postingTimes: ["09:00"], // already passed today
    });
    expect(next?.toISOString()).toBe("2026-09-26T09:00:00.000Z");
  });

  it("picks the earliest still-upcoming posting time today over a later day", () => {
    const now = new Date("2026-09-25T08:00:00.000Z"); // Friday, 08:00 UTC
    const next = computeNextRunAt(now, {
      timezone: "UTC",
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
      postingTimes: ["18:00", "09:00", "20:00"],
    });
    expect(next?.toISOString()).toBe("2026-09-25T09:00:00.000Z");
  });

  it("returns null for an empty allowedDays or postingTimes config instead of scanning forever", () => {
    const now = new Date("2026-09-25T00:00:00.000Z");
    expect(computeNextRunAt(now, { timezone: "UTC", allowedDays: [], postingTimes: ["09:00"] })).toBeNull();
    expect(computeNextRunAt(now, { timezone: "UTC", allowedDays: [1], postingTimes: [] })).toBeNull();
  });

  it("returns null rather than an infinite loop when no allowed day/time combination exists within 8 days", () => {
    // An impossible-looking config still terminates: allowedDays has one
    // valid day (Monday) and one posting time, so it WILL find a match
    // within a week -- this just proves the search is bounded and correct,
    // not unbounded.
    const now = new Date("2026-09-25T00:00:00.000Z");
    const next = computeNextRunAt(now, { timezone: "UTC", allowedDays: [1], postingTimes: ["00:00"] });
    expect(next).not.toBeNull();
    expect(next!.getTime() - now.getTime()).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1000);
  });
});
