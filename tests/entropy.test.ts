import { describe, it, expect } from "vitest";
import { shannonEntropy } from "../src/modules/detection/entropy";

describe("shannonEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for single repeated character", () => {
    expect(shannonEntropy("aaaaaaa")).toBe(0);
  });

  it("returns 1 for two equally distributed characters", () => {
    const result = shannonEntropy("ab");
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("returns higher entropy for random-looking strings", () => {
    const low = shannonEntropy("aaaabbbb");
    const high = shannonEntropy("xK9f3mQ7pZ2wL8");
    expect(high).toBeGreaterThan(low);
  });

  it("returns high entropy (>4.5) for typical secret-like strings", () => {
    const entropy = shannonEntropy("xK9f3mQ7pZ2wL8nR5vY1cT6bJ4");
    expect(entropy).toBeGreaterThan(4.0);
  });

  it("returns low entropy for repetitive strings", () => {
    const entropy = shannonEntropy("abababababab");
    expect(entropy).toBeLessThan(2.0);
  });
});
