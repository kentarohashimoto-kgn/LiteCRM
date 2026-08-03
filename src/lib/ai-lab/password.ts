import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 受講者(ai_lab_users)のパスワードハッシュ。
 *
 * 受講者は Supabase Auth のユーザーではないため、自前でハッシュを持つ。
 * 外部依存(bcryptjs等)を足さずに済むよう Node 標準の scrypt を使う。
 * 保存形式: scrypt$N$r$p$salt(base64)$hash(base64)
 * パラメータを保存形式に含めているので、将来コストを上げても既存行を検証できる。
 */

const N = 16384; // CPU/メモリコスト
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, params: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    // maxmem の既定(32MB)は N=16384,r=8 では足りないため明示的に広げる。
    scrypt(password, salt, keylen, { ...params, maxmem: 256 * 1024 * 1024 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** 保存形式が壊れていても例外は投げず false を返す(ログイン処理を落とさない)。 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
    const params = { N: Number(nStr), r: Number(rStr), p: Number(pStr) };
    if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = await scryptAsync(plain, salt, expected.length, params);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// 紛らわしい文字(0/O/1/l/I)を除いた集合。研修中に口頭やチャットで共有されるため読み違えを避ける。
const PW_CHARS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 初期パスワードの自動生成。管理画面の発行結果に一度だけ平文表示する。 */
export function generatePassword(length = 14): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += PW_CHARS[bytes[i] % PW_CHARS.length];
  return out;
}
