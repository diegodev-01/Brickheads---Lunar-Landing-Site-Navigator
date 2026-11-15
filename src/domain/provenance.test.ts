import { describe, expect, it } from "vitest";
import {
  combineProvenance,
  minConfidence,
  parseProvenanceKind,
  type ProvenanceTag,
} from "./provenance";

const tag = (
  kind: ProvenanceTag["kind"],
  confidence: ProvenanceTag["confidence"],
): ProvenanceTag => ({
  kind,
  confidence,
  source: "test",
  verified: true,
});

describe("provenance", () => {
  it("maps legacy labels and defaults unknown labels to simulated", () => {
    expect(parseProvenanceKind("real")).toBe("measured");
    expect(parseProvenanceKind("mock")).toBe("simulated");
    expect(parseProvenanceKind("derived")).toBe("derived");
    expect(parseProvenanceKind("???")).toBe("simulated");
    expect(parseProvenanceKind(undefined)).toBe("simulated");
  });

  it("takes the weakest confidence", () => {
    expect(minConfidence("high", "medium", "high")).toBe("medium");
    expect(minConfidence("high", "low")).toBe("low");
    expect(minConfidence()).toBe("low");
  });

  it("never labels a computation as measured, and lets simulated inputs win", () => {
    expect(combineProvenance("x", tag("measured", "high")).kind).toBe("derived");
    expect(combineProvenance("x", tag("measured", "high"), tag("simulated", "medium")).kind).toBe(
      "simulated",
    );
    expect(combineProvenance("x", tag("derived", "high"), tag("measured", "low")).confidence).toBe(
      "low",
    );
  });

  it("propagates unverified inputs", () => {
    const unverified = { ...tag("simulated", "low"), verified: false };
    expect(combineProvenance("x", tag("measured", "high"), unverified).verified).toBe(false);
  });
});
