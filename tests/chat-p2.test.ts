import { describe, it, expect, afterEach } from "vitest";
import { verifyChatRequest } from "@/lib/chat/verify";
import { executeChatCommand } from "@/lib/chat/commands";
import type { ResolvedSender } from "@/lib/chat/identities";

const ORIG = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
afterEach(() => {
  if (ORIG === undefined) delete process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  else process.env.GOOGLE_CHAT_PROJECT_NUMBER = ORIG;
});

describe("verifyChatRequest（受信検証・早期リターン）", () => {
  it("GOOGLE_CHAT_PROJECT_NUMBER 未設定なら fail-closed", async () => {
    delete process.env.GOOGLE_CHAT_PROJECT_NUMBER;
    const r = await verifyChatRequest("Bearer xxx");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("GOOGLE_CHAT_PROJECT_NUMBER");
  });

  it("Bearer 無しは拒否", async () => {
    process.env.GOOGLE_CHAT_PROJECT_NUMBER = "123456789";
    const r = await verifyChatRequest(null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing bearer");
  });

  it("壊れたトークンは拒否", async () => {
    process.env.GOOGLE_CHAT_PROJECT_NUMBER = "123456789";
    const r = await verifyChatRequest("Bearer not-a-jwt");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed token");
  });
});

describe("executeChatCommand（DB非依存の分岐）", () => {
  const sender: ResolvedSender = {
    chatUserId: "users/1",
    tenantId: "t1",
    userId: "u1",
    displayName: "テスト",
  };
  const titleOf = (p: any) => p.cardsV2?.[0]?.card?.header?.title as string | undefined;

  it("空入力はヘルプカードを返す", async () => {
    const p = await executeChatCommand("", sender);
    expect(titleOf(p)).toContain("使い方");
  });

  it("「ヘルプ」はヘルプカードを返す", async () => {
    const p = await executeChatCommand("ヘルプ", sender);
    expect(titleOf(p)).toContain("使い方");
  });

  it("未知コマンドはヘルプにフォールバック", async () => {
    const p = await executeChatCommand("よくわからない指示", sender);
    expect(titleOf(p)).toContain("使い方");
  });
});
