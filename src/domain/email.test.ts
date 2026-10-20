import { describe, expect, it } from "vitest";
import { escapeHtml, renderTemplate, smtpHostProblem } from "./email";

describe("email templates", () => {
  it("escapes html in variables and subjects stay one line", () => {
    const rendered = renderTemplate({
      subject: "Hello {{name}}\nBcc: x",
      body: "Hi {{name}}\n<script>alert(1)</script>\n{{actionUrl}}",
      vars: { name: "<b>Ann</b>", actionUrl: "javascript:alert(1)" },
      platformName: "HIOBuy",
      logoUrl: "javascript:alert(1)",
      appUrl: "https://example.com/app",
    });
    expect(rendered.subject).not.toContain("\n");
    expect(rendered.html).toContain("&lt;b&gt;Ann&lt;/b&gt;");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).toContain("https://example.com/app");
  });

  it("allows a normal action link", () => {
    const rendered = renderTemplate({
      subject: "Verify",
      body: "{{actionUrl}}",
      vars: { actionUrl: "https://example.com/auth/verify-email?token=abc" },
      platformName: "HIOBuy",
      logoUrl: null,
      appUrl: null,
    });
    expect(rendered.html).toContain('href="https://example.com/auth/verify-email?token=abc"');
    expect(rendered.html).toContain(">View details</a>");
    expect(rendered.html).not.toMatch(/<a[^>]*>https:/);
    expect(escapeHtml(`a&b`)).toBe("a&amp;b");
  });

  it("uses the label after a colon as the button text", () => {
    const rendered = renderTemplate({
      subject: "Verify",
      body: "{{verification_url:Verify email}}",
      vars: { verification_url: "https://example.com/auth/verify-email?token=abc" },
      platformName: "HIOBuy",
      logoUrl: null,
      appUrl: null,
    });
    expect(rendered.html).toContain(">Verify email</a>");
    expect(rendered.text).toContain("Verify email\nhttps://example.com/auth/verify-email?token=abc");
    const hostile = renderTemplate({
      subject: "Verify",
      body: "{{verification_url:<b>x</b>}}",
      vars: { verification_url: "https://example.com/go" },
      platformName: "HIOBuy",
      logoUrl: null,
      appUrl: null,
    });
    expect(hostile.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(hostile.html).not.toContain("<b>x</b>");
  });

  it("does not fill variables outside the allowlist", () => {
    const rendered = renderTemplate({
      subject: "Hi {{customer_name}}",
      body: "Code {{secret}} for {{customer_name}}",
      vars: { customer_name: "Alex", secret: "should-stay" },
      platformName: "HIOBuy",
      logoUrl: null,
      appUrl: null,
    });
    expect(rendered.subject).toBe("Hi Alex");
    expect(rendered.html).toContain("{{secret}}");
    expect(rendered.html).not.toContain("should-stay");
  });

  it("blocks private smtp hosts", () => {
    expect(smtpHostProblem("smtp.example.com")).toBeNull();
    expect(smtpHostProblem("127.0.0.1")).toMatch(/not allowed/);
    expect(smtpHostProblem("10.0.0.4")).toMatch(/not allowed/);
    expect(smtpHostProblem("localhost")).toMatch(/not allowed/);
    expect(smtpHostProblem("192.168.1.2")).toMatch(/not allowed/);
  });
});