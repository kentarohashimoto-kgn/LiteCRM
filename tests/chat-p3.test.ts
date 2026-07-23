import { describe, it, expect, afterEach } from "vitest";
import { extractReaction } from "@/lib/chat/reactions";
import { verifyPubsubPush } from "@/lib/chat/pubsub-verify";

const ORIG = process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE;
afterEach(() => {
  if (ORIG === undefined) delete process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE;
  else process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE = ORIG;
});

describe("extractReaction", () => {
  it("reaction.name から message/space を導出し emoji/user を取り出す", () => {
    const ext = extractReaction({
      reaction: {
        name: "spaces/AAA/messages/BBB/reactions/CCC",
        emoji: { unicode: "✅" },
        user: { name: "users/123", email: "a@b.com", displayName: "テスト" },
      },
    });
    expect(ext).not.toBeNull();
    expect(ext!.emoji).toBe("✅");
    expect(ext!.messageName).toBe("spaces/AAA/messages/BBB");
    expect(ext!.spaceName).toBe("spaces/AAA");
    expect(ext!.sender.email).toBe("a@b.com");
  });

  it("data.reaction 形式にも対応", () => {
    const ext = extractReaction({
      data: { reaction: { name: "spaces/X/messages/Y/reactions/Z", emoji: { unicode: "🔥" } } },
    });
    expect(ext!.emoji).toBe("🔥");
    expect(ext!.spaceName).toBe("spaces/X");
  });

  it("リアクションが無ければ null", () => {
    expect(extractReaction({ foo: 1 })).toBeNull();
    expect(extractReaction({ reaction: { emoji: { unicode: "✅" } } })).toBeNull(); // name欠落
  });
});

describe("verifyPubsubPush（早期リターン）", () => {
  it("GOOGLE_CHAT_PUBSUB_AUDIENCE 未設定なら fail-closed", async () => {
    delete process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE;
    const r = await verifyPubsubPush("Bearer x");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("GOOGLE_CHAT_PUBSUB_AUDIENCE");
  });

  it("Bearer 無しは拒否", async () => {
    process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE = "https://app/api/chat/pubsub";
    const r = await verifyPubsubPush(null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing bearer");
  });

  it("壊れたトークンは拒否", async () => {
    process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE = "https://app/api/chat/pubsub";
    const r = await verifyPubsubPush("Bearer nope");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed token");
  });
});

describe("isChatInteractionEvent (P2 Pub/Sub経路)", () => {
  it("インタラクション種別を判定する", async () => {
    const { isChatInteractionEvent } = await import("@/lib/chat/interactions");
    expect(isChatInteractionEvent("MESSAGE")).toBe(true);
    expect(isChatInteractionEvent("ADDED_TO_SPACE")).toBe(true);
    expect(isChatInteractionEvent("REMOVED_FROM_SPACE")).toBe(true);
    expect(isChatInteractionEvent("google.workspace.chat.reaction.v1.created")).toBe(false);
    expect(isChatInteractionEvent(undefined)).toBe(false);
  });
});

describe("normalizeChatEvent (Workspaceアドオン形式→クラシック形式)", () => {
  it("messagePayload を MESSAGE に変換する（実受信ペイロード形状）", async () => {
    const { normalizeChatEvent } = await import("@/lib/chat/interactions");
    const raw = {
      chat: {
        user: { name: "users/102", type: "HUMAN", email: "a@b.jp", displayName: "テスト" },
        messagePayload: {
          space: { name: "spaces/AAQ", spaceType: "SPACE", displayName: "CRMチャット" },
          message: {
            name: "spaces/AAQ/messages/x.y",
            text: "@CATORCE CRM ヘルプ",
            argumentText: " ヘルプ",
            thread: { name: "spaces/AAQ/threads/x" },
            sender: { name: "users/102", email: "a@b.jp" },
          },
        },
      },
      commonEventObject: { hostApp: "CHAT" },
    };
    const ev = normalizeChatEvent(raw);
    expect(ev.type).toBe("MESSAGE");
    expect(ev.space.name).toBe("spaces/AAQ");
    expect(ev.message.argumentText).toBe(" ヘルプ");
    expect(ev.message.thread.name).toBe("spaces/AAQ/threads/x");
    expect(ev.user.email).toBe("a@b.jp");
  });

  it("addedToSpacePayload / removedFromSpacePayload を変換する", async () => {
    const { normalizeChatEvent } = await import("@/lib/chat/interactions");
    const added = normalizeChatEvent({ chat: { user: { email: "a@b.jp" }, addedToSpacePayload: { space: { name: "spaces/X" } } } });
    expect(added.type).toBe("ADDED_TO_SPACE");
    expect(added.space.name).toBe("spaces/X");
    const removed = normalizeChatEvent({ chat: { removedFromSpacePayload: { space: { name: "spaces/Y" } } } });
    expect(removed.type).toBe("REMOVED_FROM_SPACE");
  });

  it("クラシック形式はそのまま、対象外は null", async () => {
    const { normalizeChatEvent } = await import("@/lib/chat/interactions");
    expect(normalizeChatEvent({ type: "MESSAGE", message: {} }).type).toBe("MESSAGE");
    expect(normalizeChatEvent({ eventType: "google.workspace.chat.reaction.v1.created" })).toBeNull();
    expect(normalizeChatEvent({ chat: { user: {} } })).toBeNull();
  });
});
