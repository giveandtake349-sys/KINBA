import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./cookies";

describe("session cookies behind deployment proxies", () => {
  it("uses a secure same-site cookie for the normal single-service Render deployment", () => {
    const options = getSessionCookieOptions({
      protocol: "http",
      headers: { "x-forwarded-proto": "https" },
    } as never);
    expect(options).toMatchObject({ secure: true, sameSite: "lax", httpOnly: true, path: "/" });
  });

  it("uses a secure cross-site cookie only when explicitly enabled", () => {
    const previous = process.env.CROSS_SITE_SESSION;
    process.env.CROSS_SITE_SESSION = "true";
    const options = getSessionCookieOptions({ protocol: "https", headers: {} } as never);
    expect(options).toMatchObject({ secure: true, sameSite: "none" });
    process.env.CROSS_SITE_SESSION = previous;
  });
});
