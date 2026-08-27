import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin, parseAllowedOrigins } from "./httpSecurity";

describe("Render CORS origin controls", () => {
  it("allows only configured HTTPS frontend origins", () => {
    const allowed = parseAllowedOrigins("https://nivo.onrender.com, https://app.example.com");
    expect(isAllowedCorsOrigin("https://nivo.onrender.com", allowed)).toBe(true);
    expect(isAllowedCorsOrigin("https://evil.example", allowed)).toBe(false);
  });

  it("does not enable cross-origin credentials without an explicit trusted origin", () => {
    const allowed = parseAllowedOrigins(undefined);
    expect(isAllowedCorsOrigin("https://nivo.onrender.com", allowed)).toBe(false);
  });
});
