import { describe, it, expect } from "vitest";
import {
  PROTECT_PERIODS,
  DEFAULT_PROTECT_HOURS,
  HOURS_PER_MONTH,
  HOURS_PER_YEAR,
  formatProtectionRemaining,
} from "@/utils/protection.js";

// What this file is protecting.
//
// Someone protecting a file is protecting evidence. Two numbers decide whether that
// works: the period sent to the server, and the period reported back. Both used to be
// expressed in hours, and both were wrong for the way the feature is actually used --
// one asked a person to type 43800, the other answered "1826d 0h remaining".
//
// Neither of those fails loudly. A wrong period is a file that stops being protected
// on a date nobody expected, and the only sign is the absence of one.

const HOUR = 3600000;
const DAY = 24 * HOUR;

describe("protection periods", () => {
  it("agrees with itself at twelve months", () => {
    // If these two ever drift, "12 months" and "1 year" become different lengths and
    // nothing anywhere would say so.
    expect(12 * HOURS_PER_MONTH).toBe(HOURS_PER_YEAR);
  });

  it("offers periods in months and years, never hours", () => {
    for (const period of PROTECT_PERIODS) {
      expect(period.hours % HOURS_PER_MONTH).toBe(0);
    }
  });

  it("is ordered shortest to longest", () => {
    const hours = PROTECT_PERIODS.map((p) => p.hours);
    expect([...hours].sort((a, b) => a - b)).toEqual(hours);
  });

  it("stays within the ten-year ceiling the server already had", () => {
    expect(
      Math.max(...PROTECT_PERIODS.map((p) => p.hours)),
    ).toBeLessThanOrEqual(87600);
  });

  it("defaults to a period that is actually on the list", () => {
    // A default that is not selectable would show an empty dropdown, and clicking
    // straight through would send nothing.
    expect(PROTECT_PERIODS.some((p) => p.hours === DEFAULT_PROTECT_HOURS)).toBe(
      true,
    );
  });
});

describe("formatProtectionRemaining", () => {
  it("reports long periods in years, not thousands of days", () => {
    expect(formatProtectionRemaining(5 * 365 * DAY)).toBe("5 years remaining");
  });

  it("adds months only when there are some", () => {
    expect(formatProtectionRemaining((365 + 90) * DAY)).toBe(
      "1 year 3 months remaining",
    );
    expect(formatProtectionRemaining(366 * DAY)).toBe("1 year remaining");
  });

  it("uses months in the middle range", () => {
    expect(formatProtectionRemaining(90 * DAY)).toBe("3 months remaining");
    expect(formatProtectionRemaining(95 * DAY)).toBe(
      "3 months 5 days remaining",
    );
  });

  it("keeps days and hours for the last stretch, when precision starts to matter", () => {
    expect(formatProtectionRemaining(3 * DAY + 4 * HOUR)).toBe(
      "3d 4h remaining",
    );
    expect(formatProtectionRemaining(5 * HOUR + 30 * 60000)).toBe(
      "5h 30m remaining",
    );
    expect(formatProtectionRemaining(45 * 60000)).toBe("45m remaining");
  });

  it("says singular when there is one of something", () => {
    expect(formatProtectionRemaining(400 * DAY)).toBe(
      "1 year 1 month remaining",
    );
  });

  it("treats an elapsed or missing protection as expired rather than negative", () => {
    // A negative remainder formatted as "-3 years remaining" would read as protected.
    expect(formatProtectionRemaining(-DAY)).toBe("Expired");
    expect(formatProtectionRemaining(0)).toBe("Expired");
    expect(formatProtectionRemaining(NaN)).toBe("Expired");
  });
});
