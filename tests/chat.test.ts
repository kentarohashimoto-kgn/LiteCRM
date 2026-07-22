import { describe, it, expect, afterEach } from "vitest";
import { textMessage, cardMessage } from "@/lib/chat/cards";
import { getChatCredentials, isChatConfigured } from "@/lib/chat/client";
import { sendChatMessage } from "@/lib/chat/send";

const ORIG = process.env.GOOGLE_CHAT_SA_CREDENTIALS;
afterEach(() => {
  if (ORIG === undefined) delete process.env.GOOGLE_CHAT_SA_CREDENTIALS;
  else process.env.GOOGLE_CHAT_SA_CREDENTIALS = ORIG;
});

describe("chat cards", () => {
  it("textMessage はテキストペイロードを返す", () => {
    expect(textMessage("hello")).toEqual({ text: "hello" });
  });

  it("cardMessage は見出し・本文・ボタンを組み立てる", () => {
    const p = cardMessage({
      title: "今日のダイジェスト",
      lines: ["アポ 2件", "超過AC 1件"],
      buttonText: "開く",
      buttonUrl: "https://example.com/app",
      messageKind: "digest",
    });
    const card = (p.cardsV2 as any[])[0];
    expect(card.cardId).toBe("kind:digest"); // messageKind を cardId に埋め込む
    expect(card.card.header.title).toBe("今日のダイジェスト");
    const widgets = card.card.sections[0].widgets;
    expect(widgets[0].textParagraph.text).toContain("アポ 2件");
    expect(widgets[0].textParagraph.text).toContain("<br>"); // 行は <br> 結合
    expect(widgets[1].buttonList.buttons[0].onClick.openLink.url).toBe("https://example.com/app");
  });

  it("messageKind 未指定なら cardId は既定値", () => {
    const p = cardMessage({ title: "x" });
    expect((p.cardsV2 as any[])[0].cardId).toBe("card");
  });
});

describe("chat credentials", () => {
  it("未設定なら getChatCredentials は null / isChatConfigured は false", () => {
    delete process.env.GOOGLE_CHAT_SA_CREDENTIALS;
    expect(getChatCredentials()).toBeNull();
    expect(isChatConfigured()).toBe(false);
  });

  it("不正な値なら null（例外を投げない）", () => {
    process.env.GOOGLE_CHAT_SA_CREDENTIALS = "not-a-json";
    expect(getChatCredentials()).toBeNull();
  });

  it("生JSONを解釈し private_key の \\n を復元する", () => {
    process.env.GOOGLE_CHAT_SA_CREDENTIALS = JSON.stringify({
      client_email: "bot@example.iam.gserviceaccount.com",
      private_key: "line1\\nline2",
    });
    const creds = getChatCredentials();
    expect(creds?.client_email).toBe("bot@example.iam.gserviceaccount.com");
    expect(creds?.private_key).toBe("line1\nline2");
    expect(creds?.token_uri).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("sendChatMessage フェイルセーフ", () => {
  it("未設定なら送信せず skipped を返す（no-op）", async () => {
    delete process.env.GOOGLE_CHAT_SA_CREDENTIALS;
    const res = await sendChatMessage({ type: "space", spaceName: "spaces/AAA" }, textMessage("hi"));
    expect(res).toMatchObject({ ok: true, sent: 0, failed: 0 });
    expect(res.skipped).toContain("not configured");
  });
});
