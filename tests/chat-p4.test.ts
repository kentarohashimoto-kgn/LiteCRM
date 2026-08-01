import { describe, it, expect } from "vitest";
import { extractMessageCreated, formatChatLines } from "@/lib/chat/messages";

describe("extractMessageCreated", () => {
  it("message から名前/スペース/スレッド/送信者/本文を取り出す", () => {
    const ext = extractMessageCreated({
      message: {
        name: "spaces/AAA/messages/BBB",
        text: "見積もり送りました",
        thread: { name: "spaces/AAA/threads/CCC" },
        sender: { name: "users/123", type: "HUMAN" },
        createTime: "2026-08-01T01:00:00Z",
      },
    });
    expect(ext).not.toBeNull();
    expect(ext!.messageName).toBe("spaces/AAA/messages/BBB");
    expect(ext!.spaceName).toBe("spaces/AAA");
    expect(ext!.threadName).toBe("spaces/AAA/threads/CCC");
    expect(ext!.senderChatUserId).toBe("users/123");
    expect(ext!.senderIsBot).toBe(false);
    expect(ext!.text).toBe("見積もり送りました");
    expect(ext!.createTime).toBe("2026-08-01T01:00:00Z");
  });

  it("data.message 形式にも対応し、space.name があれば優先", () => {
    const ext = extractMessageCreated({
      data: {
        message: {
          name: "spaces/X/messages/Y",
          space: { name: "spaces/X" },
          text: "  前後空白は除去  ",
        },
      },
    });
    expect(ext!.spaceName).toBe("spaces/X");
    expect(ext!.text).toBe("前後空白は除去");
  });

  it("BOT 送信者を判定する", () => {
    const ext = extractMessageCreated({
      message: { name: "spaces/X/messages/Y", text: "通知", sender: { name: "users/bot", type: "BOT" } },
    });
    expect(ext!.senderIsBot).toBe(true);
  });

  it("message や name が無ければ null", () => {
    expect(extractMessageCreated({ foo: 1 })).toBeNull();
    expect(extractMessageCreated({ message: { text: "nameなし" } })).toBeNull();
  });
});

describe("formatChatLines", () => {
  it("JST日時 + スペース表示名 + 発言者名で整形する", () => {
    const lines = formatChatLines(
      [
        { space_name: "spaces/A", sender_user_id: "u1", text: "了解  です\n改行も圧縮", create_time: "2026-08-01T01:05:00Z" },
        { space_name: "spaces/B", sender_user_id: null, text: "未登録ユーザーの発言", create_time: null },
      ],
      new Map([["spaces/A", "営業チーム"]]),
      new Map([["u1", "橋本"]]),
    );
    expect(lines[0]).toBe("- [08-01 10:05 / 営業チーム / 橋本] 了解 です 改行も圧縮");
    // 表示名が無いスペースは space_name のまま、未解決の発言者は「不明」
    expect(lines[1]).toBe("- [— / spaces/B / 不明] 未登録ユーザーの発言");
  });

  it("本文は300文字で切り詰める", () => {
    const long = "あ".repeat(400);
    const lines = formatChatLines(
      [{ space_name: "spaces/A", sender_user_id: null, text: long, create_time: null }],
      new Map(),
      new Map(),
    );
    expect(lines[0].endsWith("あ".repeat(10))).toBe(true);
    expect(lines[0]).toContain("あ".repeat(300));
    expect(lines[0]).not.toContain("あ".repeat(301));
  });
});
