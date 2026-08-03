import { describe, it, expect } from "vitest";
import { openaiErrorFor } from "@/lib/ai-lab/providers/openai";

const body = (error: Record<string, string>) => JSON.stringify({ error });

describe("OpenAI エラーの原因区分", () => {
  it("残高不足は 429 で来るが、待っても直らないので混雑と分ける", () => {
    // ここを rate_limited にすると「1分待ってください」と誤案内してしまう。
    const e = openaiErrorFor(429, body({ code: "insufficient_quota", message: "You exceeded your current quota" }));
    expect(e.code).toBe("config_error");
    expect(e.message).toContain("残高");
  });

  it("本当の混雑は rate_limited", () => {
    expect(openaiErrorFor(429, body({ code: "rate_limit_exceeded", message: "Rate limit reached" })).code).toBe(
      "rate_limited",
    );
  });

  it("401 はキーの問題として扱う", () => {
    const e = openaiErrorFor(401, body({ code: "invalid_api_key", message: "Incorrect API key provided" }));
    expect(e.code).toBe("config_error");
    expect(e.message).toContain("OPENAI_API_KEY");
  });

  it("403 は本人確認の可能性を示す(gpt-image はここで弾かれる)", () => {
    const e = openaiErrorFor(403, body({ message: "Your organization must be verified" }));
    expect(e.code).toBe("config_error");
    expect(e.message).toContain("本人確認");
  });

  it("モデルIDの誤りは設定の問題として切り分けられる", () => {
    const e = openaiErrorFor(404, body({ code: "model_not_found", message: "The model does not exist" }));
    expect(e.code).toBe("config_error");
    expect(e.message).toContain("モデルID");
  });

  it("内容ブロックは設定不備ではなく refused", () => {
    // 画像生成では日常的に起きる。運営への連絡を促す文言になると受講者が詰まる。
    expect(openaiErrorFor(400, body({ code: "moderation_blocked", message: "blocked" })).code).toBe("refused");
    expect(openaiErrorFor(400, body({ message: "Request rejected by the safety system" })).code).toBe("refused");
  });

  it("大きすぎるリクエストは too_large", () => {
    expect(openaiErrorFor(413, "").code).toBe("too_large");
  });

  it("原因が分からないものは provider_error にステータスを残す", () => {
    const e = openaiErrorFor(500, body({ message: "server had an error" }));
    expect(e.code).toBe("provider_error");
    expect(e.message).toContain("500");
  });

  it("APIの本文はそのまま残す(切り分けに要る)", () => {
    expect(openaiErrorFor(500, body({ message: "server had an error" })).message).toContain("server had an error");
  });

  it("本文がJSONでなくても落ちない", () => {
    expect(openaiErrorFor(502, "<html>Bad Gateway</html>").code).toBe("provider_error");
    expect(openaiErrorFor(500).code).toBe("provider_error");
  });
});
