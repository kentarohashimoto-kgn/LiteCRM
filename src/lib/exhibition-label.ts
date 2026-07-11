/**
 * 展示会（campaign, channel=exhibition）の「表記統一」と「最新化」を担う純ロジック。
 *
 *  - 表記ルール: `YYYYMM_展示会名`。YYYYMM は開催日(event_date)を唯一の正本として導出するため、
 *    手入力の揺れ（"2606"/"2026/6" 等）に依存せず、常に一意な接頭辞になる。
 *  - 最新化: 実施済み判定は「状態=done」または「開催日が今日より前」。日付が過ぎれば自動で
 *    実施済みへ移るため、状態の手動更新に依存しない。
 */

/** event_date(YYYY-MM-DD) → YYYYMM。無効なら null。 */
export function ymFromDate(date?: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})/.exec(date.trim());
  return m ? `${m[1]}${m[2]}` : null;
}

/**
 * 展示会名から日付プレフィックスを除いた「核となる名称」を返す。
 * 例: "202606_AIEXPO幕張" → "AIEXPO幕張" / "20260610_AINATIVEEXPO" → "AINATIVEEXPO"
 * 先頭に日付が無い名前（"ODEX2606" 等）はそのまま返す。
 */
export function exhibitionCoreName(name?: string | null): string {
  return (name ?? "")
    .trim()
    // 先頭の YYYYMM / YYYYMMDD（＋区切り）を除去
    .replace(/^\d{6,8}\s*[_＿\-–—.\s]+\s*/u, "")
    // 先頭の YYYY＋区切り（"2026_" 等。区切り必須で誤除去を防止）を除去
    .replace(/^\d{4}\s*[_＿]\s*/u, "")
    .trim();
}

/**
 * 表示・保存用の統一ラベル `YYYYMM_展示会名` を返す。
 * event_date が無い場合は接頭辞を付けず核名のみ。
 */
export function exhibitionLabel(c: { name: string; event_date?: string | null }): string {
  const core = exhibitionCoreName(c.name) || (c.name ?? "").trim();
  const ym = ymFromDate(c.event_date);
  return ym ? `${ym}_${core}` : core;
}

/**
 * 実施済み（過去）判定。状態が done、または開催日が today より前なら実施済み。
 * today は "YYYY-MM-DD"（JST基準を推奨）。
 */
export function isExhibitionDone(
  c: { event_status?: string | null; event_date?: string | null },
  today: string,
): boolean {
  if (c.event_status === "done") return true;
  return !!c.event_date && c.event_date < today;
}
