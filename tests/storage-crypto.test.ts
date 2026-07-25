import { describe, it, expect, beforeAll } from "vitest";
import { asciiStorageKey } from "@/lib/storage-key";
import { decryptSecretEdge } from "@/lib/crypto-mail-edge";

describe("asciiStorageKey", () => {
  it("日本語ファイル名からASCIIのみのキーを生成する(Supabase Invalid key対策)", () => {
    const key = asciiStorageKey("積水ハウス様_診断コンテンツ制作提案.pdf");
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });
  it("拡張子なし・不正拡張子はUUIDのみ", () => {
    expect(asciiStorageKey("報告書")).toMatch(/^[0-9a-f-]{36}$/);
    expect(asciiStorageKey("archive.tar.gz.日本語")).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("大文字拡張子は小文字化される", () => {
    expect(asciiStorageKey("PHOTO.JPG")).toMatch(/\.jpg$/);
  });
});

describe("decryptSecretEdge (crypto-mail.ts 互換)", () => {
  beforeAll(() => {
    process.env.MAIL_CRED_SECRET = "test-secret-for-unit-tests";
  });
  it("node版encryptSecretの出力をWebCrypto版で復号できる", async () => {
    const { encryptSecret } = await import("@/lib/crypto-mail");
    const plain = "1//refresh-token-サンプル-äöü";
    const enc = encryptSecret(plain);
    const dec = await decryptSecretEdge(enc, process.env.MAIL_CRED_SECRET!);
    expect(dec).toBe(plain);
  });
  it("鍵が違えば復号に失敗する", async () => {
    const { encryptSecret } = await import("@/lib/crypto-mail");
    const enc = encryptSecret("secret-data");
    await expect(decryptSecretEdge(enc, "wrong-key")).rejects.toThrow();
  });
});
