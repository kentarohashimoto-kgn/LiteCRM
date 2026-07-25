/**
 * crypto-mail.ts の保存形式 base64(iv[12] || tag[16] || ct) を
 * Edgeランタイム(WebCrypto)で復号する版。node:crypto が使えない
 * Edge Route(録音音声プロキシ等)から使用する。鍵導出は同じく SHA-256(secret)。
 */

export async function decryptSecretEdge(payload: string, secret: string): Promise<string> {
  const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const ct = raw.slice(28);
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  // WebCrypto は ciphertext||tag を1つのバッファで受け取る
  const data = new Uint8Array(ct.length + tag.length);
  data.set(ct, 0);
  data.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, data);
  return new TextDecoder().decode(plain);
}
