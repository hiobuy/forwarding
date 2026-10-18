import { describe, expect, it } from "vitest";
import { googleClientProblem, turnstileConfigError, turnstileKeyProblem } from "./security";
import { templateProblem } from "./email";

describe("security settings", () => {
  it("blocks dummy Turnstile keys in production and accepts a real-looking pair", () => {
    expect(turnstileKeyProblem("1x00000000000000000000AA", "1x0000000000000000000000000000000AA", true)).toMatch(/production/);
    expect(turnstileKeyProblem("0x4AAAAAAAexampleSiteKey", "0x4AAAAAAAexampleSecret", true)).toBeNull();
    expect(turnstileKeyProblem("1x00000000000000000000AA", "1x0000000000000000000000000000000AA", false)).toBeNull();
  });

  it("checks the Google client id shape and Turnstile secret errors", () => {
    expect(googleClientProblem("123-abc.apps.googleusercontent.com")).toBeNull();
    expect(googleClientProblem("not-a-client")).toMatch(/client ID/);
    expect(turnstileConfigError(["invalid-input-secret"])).toBe(true);
    expect(turnstileConfigError(["invalid-input-response"])).toBe(false);
  });

  it("keeps the verification link in security templates", () => {
    expect(templateProblem("verification", "Hello\n{{verification_url}}")).toBeNull();
    expect(templateProblem("verify_new_email", "Hello only")).toMatch(/verification link/);
    expect(templateProblem("package_received", "Hello only")).toBeNull();
  });
});
