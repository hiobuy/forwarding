import { describe, expect, it } from "vitest";
import { formatPublicNumber, numberRuleProblem, safeNextValue, sequenceFromPublicId } from "./numbering";

describe("public numbers", () => {
  it("pads the preview and keeps an empty prefix", () => {
    expect(formatPublicNumber("MB", 10001, 6)).toBe("MB010001");
    expect(formatPublicNumber("PKG", 10001, 6)).toBe("PKG010001");
    expect(formatPublicNumber("SHP", 20001, 6)).toBe("SHP020001");
    expect(formatPublicNumber("", 10001, 6)).toBe("010001");
    expect(formatPublicNumber("PKG-", 10001, 5)).toBe("PKG-10001");
  });

  it("rejects a start that cannot fit and a prefix with spaces", () => {
    expect(numberRuleProblem({ prefix: "MB", length: 6, start: 10001 })).toBeNull();
    expect(numberRuleProblem({ prefix: "MB", length: 4, start: 10001 })).toMatch(/fit/);
    expect(numberRuleProblem({ prefix: "M B", length: 6, start: 1 })).toMatch(/Prefix/);
  });

  it("moves the next number past numbers already used", () => {
    const same = safeNextValue({ requestedStart: 10001, currentNext: 10001, prefixChanged: false, used: [10020, 10004] });
    expect(same).toEqual({ next: 10021, adjusted: true });
    const ahead = safeNextValue({ requestedStart: 30000, currentNext: 10050, prefixChanged: false, used: [10020] });
    expect(ahead).toEqual({ next: 30000, adjusted: false });
    const renamed = safeNextValue({ requestedStart: 10001, currentNext: 90000, prefixChanged: true, used: [] });
    expect(renamed).toEqual({ next: 10001, adjusted: false });
  });

  it("does not reuse a number when issuance is serial", () => {
    const used = new Set<string>();
    let next = 10001;
    for (let index = 0; index < 40; index += 1) {
      const id = formatPublicNumber("PKG", next, 6);
      next += 1;
      expect(used.has(id)).toBe(false);
      used.add(id);
    }
    expect(used.size).toBe(40);
    expect(sequenceFromPublicId("PKG010040", "PKG")).toBe(10040);
    expect(sequenceFromPublicId("SHP010040", "PKG")).toBeNull();
  });
});
