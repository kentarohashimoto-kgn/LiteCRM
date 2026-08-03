import { describe, it, expect } from "vitest";
import { signLabToken, verifyLabToken } from "@/lib/ai-lab/token";

const SECRET = "test-secret-value-please-change-me";
const future = Math.floor(Date.now() / 1000) + 3600;

describe("AI Lab セッショントークン", () => {
  it("署名したトークンを検証すると元の内容に戻る", async () => {
    const token = await signLabToken({ uid: "u1", cid: "c1", exp: future }, SECRET);
    expect(await verifyLabToken(token, SECRET)).toEqual({ uid: "u1", cid: "c1", exp: future });
  });

  it("署名を改ざんしたトークンは無効", async () => {
    const token = await signLabToken({ uid: "u1", cid: "c1", exp: future }, SECRET);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await verifyLabToken(tampered, SECRET)).toBeNull();
  });

  it("ペイロードを差し替えると署名が合わず無効", async () => {
    const token = await signLabToken({ uid: "u1", cid: "c1", exp: future }, SECRET);
    const forged = Buffer.from(JSON.stringify({ uid: "u2", cid: "c1", exp: future })).toString("base64url");
    expect(await verifyLabToken(`${forged}.${token.split(".")[1]}`, SECRET)).toBeNull();
  });

  it("期限切れのトークンは無効", async () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    const token = await signLabToken({ uid: "u1", cid: "c1", exp: past }, SECRET);
    expect(await verifyLabToken(token, SECRET)).toBeNull();
  });

  it("別の鍵で署名したトークンは無効", async () => {
    const token = await signLabToken({ uid: "u1", cid: "c1", exp: future }, "another-secret");
    expect(await verifyLabToken(token, SECRET)).toBeNull();
  });

  it("壊れた入力でも例外を投げずに null を返す", async () => {
    for (const bad of ["", "dot-less", ".", "a.", ".b", "!!!.???", "null.null"]) {
      expect(await verifyLabToken(bad, SECRET)).toBeNull();
    }
    expect(await verifyLabToken(null, SECRET)).toBeNull();
    expect(await verifyLabToken(undefined, SECRET)).toBeNull();
  });

  it("鍵が未設定なら常に無効(環境変数の設定漏れで素通りさせない)", async () => {
    const token = await signLabToken({ uid: "u1", cid: "c1", exp: future }, SECRET);
    expect(await verifyLabToken(token, "")).toBeNull();
  });
});
