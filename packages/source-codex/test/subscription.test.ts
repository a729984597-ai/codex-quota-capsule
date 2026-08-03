import { describe, expect, it } from "vitest";
import { parseCodexSubscriptionAuth } from "../src/subscription.ts";

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `test.${encoded}.signature`;
}

function authWithClaims(claims: Record<string, unknown>): unknown {
  return {
    tokens: {
      id_token: jwt({
        "https://api.openai.com/auth": claims,
      }),
    },
  };
}

describe("parseCodexSubscriptionAuth", () => {
  it("extracts only the Plus subscription active-until timestamp", () => {
    const subscription = parseCodexSubscriptionAuth(
      authWithClaims({
        chatgpt_plan_type: "plus",
        chatgpt_subscription_active_start: "2026-07-22T01:59:00.000Z",
        chatgpt_subscription_active_until: "2026-08-22T01:59:00.000Z",
        email: "must-not-leave-the-parser@example.com",
      }),
    );

    expect(subscription).toEqual({
      planType: "plus",
      activeUntil: new Date("2026-08-22T01:59:00.000Z"),
    });
    expect(subscription).not.toHaveProperty("email");
  });

  it("does not show free plans as a Plus subscription", () => {
    expect(
      parseCodexSubscriptionAuth(
        authWithClaims({
          chatgpt_plan_type: "free",
          chatgpt_subscription_active_until: "2026-08-22T01:59:00.000Z",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for malformed or missing expiry claims", () => {
    expect(parseCodexSubscriptionAuth({ tokens: { id_token: "bad" } })).toBeNull();
    expect(
      parseCodexSubscriptionAuth(
        authWithClaims({
          chatgpt_plan_type: "plus",
          chatgpt_subscription_active_until: "not-a-date",
        }),
      ),
    ).toBeNull();
  });
});
