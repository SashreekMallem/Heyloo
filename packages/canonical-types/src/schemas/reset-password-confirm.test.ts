import { describe, expect, it } from "vitest";
import { resetPasswordConfirmSchema } from "./reset-password-confirm.js";

function messages(input: { password: string; confirm_password: string }): string[] {
  const result = resetPasswordConfirmSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("resetPasswordConfirmSchema (MAP-20)", () => {
  it("shows one friendly message per field for empty input, never raw zod text", () => {
    const all = messages({ password: "", confirm_password: "" });
    expect(all).toEqual(["Password must be at least 8 characters", "Confirm your new password"]);
    expect(all.join(" ")).not.toMatch(/Too small|expected string/);
  });

  it("a short password reports only the password rule when the confirmation matches", () => {
    expect(messages({ password: "short", confirm_password: "short" })).toEqual([
      "Password must be at least 8 characters",
    ]);
  });

  it("reports a mismatch on the confirmation field", () => {
    expect(messages({ password: "longenough1", confirm_password: "different1" })).toEqual([
      "Passwords do not match",
    ]);
  });

  it("accepts matching passwords", () => {
    expect(messages({ password: "longenough1", confirm_password: "longenough1" })).toEqual([]);
  });
});
