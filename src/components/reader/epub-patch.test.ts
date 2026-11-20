import { describe, expect, it } from "vitest";
import { clampTextWidth } from "./epub-patch";

describe("clampTextWidth", () => {
  it("trusts the body when the Range is inflated by off-screen hidden text", () => {
    expect(clampTextWidth(27941, 1567)).toBe(1567);
    expect(clampTextWidth(27941, 1566.6)).toBe(1567);
  });
  it("leaves a normal measurement alone (Range excludes body padding, so it is smaller)", () => {
    expect(clampTextWidth(1500, 1567)).toBe(1500);
    expect(clampTextWidth(800, 800)).toBe(800);
  });
  it("falls back to the measurement when the body has no usable extent", () => {
    expect(clampTextWidth(900, undefined)).toBe(900);
    expect(clampTextWidth(900, 0)).toBe(900);
  });
});
