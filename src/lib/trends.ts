/**
 * トレンド分析の純粋ヘルパー(地域区分・規模/業種/部署の正規化・ABC分類)。
 * 都道府県→地方区分、簡易地図(地方タイル)配置、各種バケット化。
 */

export const PREF_REGION: Record<string, string> = {
  北海道: "北海道",
  青森県: "東北", 岩手県: "東北", 宮城県: "東北", 秋田県: "東北", 山形県: "東北", 福島県: "東北",
  茨城県: "関東", 栃木県: "関東", 群馬県: "関東", 埼玉県: "関東", 千葉県: "関東", 東京都: "関東", 神奈川県: "関東",
  新潟県: "中部", 富山県: "中部", 石川県: "中部", 福井県: "中部", 山梨県: "中部", 長野県: "中部", 岐阜県: "中部", 静岡県: "中部", 愛知県: "中部",
  三重県: "近畿", 滋賀県: "近畿", 京都府: "近畿", 大阪府: "近畿", 兵庫県: "近畿", 奈良県: "近畿", 和歌山県: "近畿",
  鳥取県: "中国", 島根県: "中国", 岡山県: "中国", 広島県: "中国", 山口県: "中国",
  徳島県: "四国", 香川県: "四国", 愛媛県: "四国", 高知県: "四国",
  福岡県: "九州沖縄", 佐賀県: "九州沖縄", 長崎県: "九州沖縄", 熊本県: "九州沖縄", 大分県: "九州沖縄", 宮崎県: "九州沖縄", 鹿児島県: "九州沖縄", 沖縄県: "九州沖縄",
};

export const REGION_ORDER = ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州沖縄"];

/** 地方を地理的っぽく配置した簡易タイル地図(row,col)。 */
export const REGION_TILE: Record<string, { r: number; c: number }> = {
  北海道: { r: 0, c: 3 },
  東北: { r: 1, c: 3 },
  関東: { r: 2, c: 3 },
  中部: { r: 2, c: 2 },
  近畿: { r: 3, c: 2 },
  中国: { r: 3, c: 1 },
  四国: { r: 4, c: 2 },
  九州沖縄: { r: 4, c: 0 },
};

export function regionOf(pref?: string | null): string {
  const p = (pref ?? "").trim();
  return PREF_REGION[p] ?? (p ? "その他/不明" : "不明");
}

/** 従業員規模をバケット化(表記ゆれを吸収)。 */
export function empBucket(s?: string | null): string {
  const v = (s ?? "").trim();
  if (!v || /不明/.test(v)) return "不明";
  const nums = (v.match(/[\d,]+/g) || []).map((x) => parseInt(x.replace(/,/g, ""), 10)).filter((n) => !isNaN(n));
  const m = nums.length ? Math.max(...nums) : 0;
  if (m >= 1000) return "1000名以上";
  if (m >= 300) return "300〜999名";
  if (m >= 100) return "100〜299名";
  if (m > 0) return "〜99名";
  return "不明";
}
export const EMP_ORDER = ["1000名以上", "300〜999名", "100〜299名", "〜99名", "不明"];

/** 業種の先頭コード(01_ 等)を除去して表示名に。 */
export function industryLabel(s?: string | null): string {
  const v = (s ?? "").trim();
  if (!v) return "不明";
  return v.replace(/^[0-9０-９]+[._．]?\s*/, "") || v;
}

export function deptLabel(s?: string | null): string {
  const v = (s ?? "").trim();
  return v || "不明";
}

export interface AbcRow { key: string; label: string; value: number; share: number; cumShare: number; rank: "A" | "B" | "C" }
/** 金額降順で累計70%=A / 90%=B / 残りC に分類。 */
export function abcClassify(items: { key: string; label: string; value: number }[]): AbcRow[] {
  const sorted = [...items].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, x) => s + x.value, 0);
  let cum = 0;
  return sorted.map((x) => {
    const share = total > 0 ? x.value / total : 0;
    cum += share;
    const rank: "A" | "B" | "C" = cum <= 0.7 ? "A" : cum <= 0.9 ? "B" : "C";
    return { key: x.key, label: x.label, value: x.value, share, cumShare: cum, rank };
  });
}

export const TREND_SCOPES: { key: string; label: string }[] = [
  { key: "all", label: "全リード" },
  { key: "converted", label: "案件化済" },
  { key: "open", label: "オープン案件" },
  { key: "a", label: "Aヨミ" },
  { key: "b", label: "Bヨミ" },
  { key: "won", label: "受注" },
];
