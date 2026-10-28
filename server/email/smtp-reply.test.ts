import { describe, expect, it } from "vitest";
import { isCloudflareEmailHost, takeSmtpReply } from "./smtp-reply";

describe("SMTP replies", () => {
  it("waits for the final line of a multiline greeting", () => {
    expect(takeSmtpReply("250-mx.cloudflare.net greets client\r\n250-AUTH PLAIN LOGIN\r\n")).toBeNull();
    expect(takeSmtpReply("250-mx.cloudflare.net greets client\r\n250 AUTH PLAIN LOGIN\r\n")).toEqual({
      reply: { code: 250, text: "250-mx.cloudflare.net greets client 250 AUTH PLAIN LOGIN" },
      rest: "",
    });
  });

  it("keeps bytes that belong to the next reply", () => {
    expect(takeSmtpReply("220 mx.cloudflare.net ready\r\n250 ")).toEqual({
      reply: { code: 220, text: "220 mx.cloudflare.net ready" },
      rest: "250 ",
    });
  });

  it("recognizes Cloudflare Email Service SMTP, which Workers cannot dial", () => {
    expect(isCloudflareEmailHost("smtp.mx.cloudflare.net")).toBe(true);
    expect(isCloudflareEmailHost("SMTP.MX.CLOUDFLARE.NET.")).toBe(true);
    expect(isCloudflareEmailHost("smtp.example.com")).toBe(false);
  });
});
