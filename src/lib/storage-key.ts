/**
 * Supabase Storage のオブジェクトキー生成。
 * Storageのキーは日本語等の非ASCII文字を受け付けない("Invalid key")ため、
 * キーは「UUID+拡張子」のASCII安全形式とし、元のファイル名はDB側(file_name/title)に保持する。
 * (2026-07-26 静止点保存の失敗調査で判明。既存の添付・提案書・ナレッジも同修正)
 */

import { randomUUID } from "crypto";

/** 元ファイル名から拡張子だけを安全に取り出し、ASCIIのみのキー名を返す。 */
export function asciiStorageKey(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName ?? "");
  const ext = m ? `.${m[1].toLowerCase()}` : "";
  return `${randomUUID()}${ext}`;
}
