/**
 * リード・エンゲージメント（F-201/F-204 MVP）— 純粋ロジック。
 *
 * メール反応(開封/クリック/資料閲覧/返信)を既存 touchpoints(0013) の重みへ変換し、
 * 既存 person_engagement のスコア(合算値)と Fit スコア(rescore_leads / 0050)から
 * 優先グレード P1〜P5 を決める。DB非依存・tests/engagement.test.ts で回帰固定。
 *
 * スコア尺度は既存 engagement_rank_of(S>=30/A>=15/B>=7/C>=3)に合わせる。
 * 時間減衰(半減期14日)は WO-24 本実装で導入予定。展示会当日の運用では
 * 全リードが新鮮なため、MVPでは合算値のまま扱う。
 */

/** メール反応 → touchpoints.type / weight。 */
export const MAIL_TOUCH_WEIGHTS: Record<string, number> = {
  email_open: 1,
  email_click: 3,
  doc_view: 5, // 資料リンクのクリック(D8: リンク方式)
  email_reply: 8,
};

/** touchpoints.type の表示ラベル（既存タイプは各画面の表記を踏襲）。 */
export const MAIL_TOUCH_LABEL: Record<string, string> = {
  email_open: "メール開封",
  email_click: "リンククリック",
  doc_view: "資料閲覧",
  email_reply: "メール返信",
};

/** 資料リンク判定(D8): PDF / Google Drive・Docs / ストレージ配信を「資料」とみなす。 */
export function isDocumentUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (/\.(pdf|pptx?|xlsx?|docx?)([?#]|$)/.test(u)) return true;
  return /drive\.google\.com|docs\.google\.com|storage\.googleapis\.com|\/api\/documents\//.test(u);
}

/** クリックイベントの touchpoint 種別。 */
export function clickTouchType(url: string | null | undefined): "email_click" | "doc_view" {
  return url && isDocumentUrl(url) ? "doc_view" : "email_click";
}

/**
 * Fit スコアの解決: lead_score(0-100) があればそれ、無ければ rank 文字から代表値。
 * どちらも無ければ null(グレードは Engagement のみで保守的に決める)。
 */
export function resolveFitScore(leadScore: number | null | undefined, rank: string | null | undefined): number | null {
  if (typeof leadScore === "number" && leadScore > 0) return leadScore;
  const r = (rank ?? "").trim().toUpperCase();
  const map: Record<string, number> = { S: 85, A: 70, B: 55, C: 40, D: 20 };
  return r in map ? map[r] : null;
}

export type PriorityGrade = "P1" | "P2" | "P3" | "P4" | "P5";

/**
 * 優先グレード(2軸マトリクス)。
 *   Fit:  F1 >=65(S/A) / F2 >=50(B) / F3 それ未満・不明
 *   Eng:  E1 >=15(既存A以上) / E2 >=3(既存C以上) / E3 反応なし
 */
export function computeGrade(fitScore: number | null, engScore: number): PriorityGrade {
  const f = fitScore === null ? 3 : fitScore >= 65 ? 1 : fitScore >= 50 ? 2 : 3;
  const e = engScore >= 15 ? 1 : engScore >= 3 ? 2 : 3;
  const matrix: Record<number, Record<number, PriorityGrade>> = {
    1: { 1: "P1", 2: "P2", 3: "P3" },
    2: { 1: "P2", 2: "P3", 3: "P4" },
    3: { 1: "P3", 2: "P4", 3: "P5" },
  };
  return matrix[f][e];
}

/** グレードの表示情報（バッジ・推奨アクション）。 */
export const GRADE_DEFS: Record<PriorityGrade, { label: string; action: string; tone: "hot" | "warm" | "cool" }> = {
  P1: { label: "P1 今すぐ", action: "本日中に架電", tone: "hot" },
  P2: { label: "P2 今週", action: "今週中に接触(架電優先)", tone: "warm" },
  P3: { label: "P3 育成", action: "メール中心でナーチャリング", tone: "cool" },
  P4: { label: "P4 低頻度", action: "低頻度メールのみ", tone: "cool" },
  P5: { label: "P5 見直し", action: "四半期見直しで対象外検討", tone: "cool" },
};

/** 通知の宛先ロール(担当未設定リードのフォールバック)。 */
export const HOT_NOTIFY_ROLES = ["owner", "admin", "inside_sales"];
