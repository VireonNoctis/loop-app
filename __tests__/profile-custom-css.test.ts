import { describe, expect, it } from "vitest";
import {
  PROFILE_CUSTOM_CSS_MAX_LENGTH,
  validateProfileCustomCss,
} from "@/lib/profile-custom-css";

describe("validateProfileCustomCss", () => {
  it("accepts normal styling and scopes every selector to the profile", () => {
    const result = validateProfileCustomCss(
      ".profile-name, h2:hover { color: #a78bfa; text-shadow: 0 0 8px rgba(167, 139, 250, 0.4); }",
    );

    expect(result.valid).toBe(true);
    expect(result.value).toContain(".profile-name");
    expect(result.scopedCss).toContain("[data-profile-custom-css] .profile-name");
    expect(result.scopedCss).toContain("[data-profile-custom-css] h2:hover");
  });

  it("allows an empty value so a saved profile style can be cleared", () => {
    expect(validateProfileCustomCss("   ")).toMatchObject({
      valid: true,
      value: "",
      scopedCss: "",
    });
  });

  it("rejects at-rules and external resource loading", () => {
    expect(validateProfileCustomCss('@import url("https://example.test/theme.css");').valid).toBe(false);
    expect(validateProfileCustomCss(".card { background-image: url(https://example.test/a.png); }").valid).toBe(false);
    expect(validateProfileCustomCss(".card { background-image: image-set('https://example.test/a.png'); }").valid).toBe(false);
  });

  it("rejects executable or page-breaking declarations", () => {
    expect(validateProfileCustomCss(".card { position: fixed; }").valid).toBe(false);
    expect(validateProfileCustomCss(".card { behavior: url(xss.htc); }").valid).toBe(false);
    expect(validateProfileCustomCss(":root { color: red; }").valid).toBe(false);
  });

  it("rejects incomplete rules and oversized input", () => {
    expect(validateProfileCustomCss(".card { color: red;").valid).toBe(false);
    expect(validateProfileCustomCss("x".repeat(PROFILE_CUSTOM_CSS_MAX_LENGTH + 1)).valid).toBe(false);
  });
});
