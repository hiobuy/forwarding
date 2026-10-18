import { describe, expect, it } from "vitest";
import { stripeKeyModeProblem } from "./payments";

describe("stripe key mode", () => {
  it("rejects a test secret in live mode", () => {
    expect(stripeKeyModeProblem("live", "sk_test_abc", "pk_live_abc")).toMatch(/live account/);
  });

  it("accepts a matching test pair", () => {
    expect(stripeKeyModeProblem("test", "sk_test_abc", "pk_test_abc")).toBeNull();
  });
});
