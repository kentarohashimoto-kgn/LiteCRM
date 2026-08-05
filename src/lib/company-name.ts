/**
 * 会社名の表記ゆれを吸収する検索キー。
 *
 * 「株式会社カトルセ」「カトルセ株式会社」「㈱カトルセ」「ｶﾄﾙｾ」「かとるせ」
 * 「CATORCE Co., Ltd.」は、すべて同じキー（"カトルセ" / "catorce"）になる。
 * 検索は「入力のキー」が「データのキー」に部分一致するかで判定するため、
 * 「株式会社カトルセ」で検索してデータが「カトルセ」だけでもヒットする。
 *
 * **DB 側の `public.company_search_key(text)`（0203）と同一の規則。**
 * 片方だけ変更するとサーバーページング検索とクライアント側の絞り込みで
 * 結果が食い違うので、必ず両方を揃えて変更すること（tests/company-name.test.ts で担保）。
 *
 * 既存の `normCompany()`（src/lib/lead-import.ts）は CSV 取込の同一会社判定に
 * 使われており、`leads.company_norm` 列や business_cards の式インデックスの値を
 * 決めているため、こちらとは別物として据え置く。
 */

/** 法人格（日本語）。長いものを先に並べる（「医療法人社団」→「医療法人」の順）。 */
const LEGAL_JP =
  /(株式会社|有限会社|合同会社|合資会社|合名会社|相互会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|社会福祉法人|医療法人社団|医療法人財団|医療法人|学校法人|宗教法人|独立行政法人|国立大学法人|公立大学法人|弁護士法人|税理士法人|司法書士法人|行政書士法人|社会保険労務士法人|監査法人|事業協同組合|農業協同組合|生活協同組合|企業組合|協同組合|\(株\)|\(有\)|\(合\)|\(名\)|\(資\)|\(社\)|\(財\)|㈱|㈲|㈳|㈶)/g;

/**
 * 法人格（英語）。前後が英数字でないときだけ除去する
 * （"Incheon" の "Inc" を削らないため）。長いものから並べる。
 */
const LEGAL_EN =
  /(?<![0-9a-z])(co\.?\s*,?\s*ltd|corporation|incorporated|company|limited|inc|corp|ltd|llc|llp|plc|gmbh|pty|k\.?k)\.?(?![0-9a-z])/g;

/** 除去する記号（NFKC 済みなので全角記号は ASCII に畳まれている前提）。 */
const PUNCT = new Set(
  Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~、。，．・：；？！゛゜〆ー―‐～〜｜…‘’“”〔〕〈〉《》「」『』【】"),
);

/**
 * 表記ゆれを畳んだ検索キーを返す。畳んだ結果が空（例: 入力が「株式会社」だけ）なら空文字。
 *
 * 手順: NFKC → 小文字化 → 法人格除去(日/英) → 空白除去 → 記号除去 → ひらがな→カタカナ。
 */
export function companySearchKey(input?: string | null): string {
  let s = (input ?? "").normalize("NFKC").toLowerCase();
  s = s.replace(LEGAL_JP, "");
  s = s.replace(LEGAL_EN, "");
  s = s.replace(/\s/g, "");
  s = Array.from(s)
    .filter((c) => !PUNCT.has(c))
    .join("");
  // ひらがな(U+3041〜U+3096) をカタカナ(U+30A1〜U+30F6)へ。DB 側の translate と等価。
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return s;
}

/** 正規化キーを保持する生成列の名前。accounts / opportunities / leads で共通（0203）。 */
export const SEARCH_KEY_COLUMN = "search_key";

/**
 * PostgREST の `.or()` に渡すフィルタ式を組み立てる。
 *
 * 生の列への ilike（従来どおりの部分一致）と、正規化キー列 `search_key` への like を OR する。
 *
 * @param rawCols  生の部分一致を掛ける列名（例: ["company_name", "contact_name"]）
 * @param query    ユーザーの入力
 * @returns or() に渡す式。検索語が空なら null（＝絞り込みなし）
 */
export function companySearchFilter(rawCols: string[], query: string): string | null {
  if (!query.trim()) return null; // 空入力は絞り込みなし
  // PostgREST の or 句はカンマ・括弧が構文文字、% と _ は LIKE のワイルドカードなので除去
  const safe = query.replace(/[,%_()]/g, " ").trim();
  // 正規化キーは記号をすべて落とすため、上記のメタ文字は原理的に残らない
  const key = companySearchKey(query);
  const parts: string[] = [];
  if (safe) parts.push(...rawCols.map((c) => `${c}.ilike.%${safe}%`));
  if (key) parts.push(`${SEARCH_KEY_COLUMN}.like.%${key}%`);
  // 記号だけの入力で条件が消えた場合、絞り込み無し(=全件)にはせず必ず0件にする
  return parts.length > 0 ? parts.join(",") : "id.is.null";
}

/**
 * 会社名（や会社名を含む文字列）が検索語にマッチするか。
 * 生の部分一致（大文字小文字無視）と、正規化キーの部分一致の OR。
 *
 * 検索語が法人格だけ（「株式会社」等）で正規化キーが空になる場合は、
 * 全件ヒットを避けるため生の部分一致だけで判定する。
 */
export function matchesCompanyQuery(target: string | null | undefined, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const t = target ?? "";
  if (t.toLowerCase().includes(q.toLowerCase())) return true;
  const key = companySearchKey(q);
  return key !== "" && companySearchKey(t).includes(key);
}
