/**
 * 配信停止導線の扱い(特定電子メール法 × 到達性)。
 *
 * 配信停止には2つの実装があり、役割が違う。
 *  - 本文フッター(可視)  : 特電法の「表示義務」を満たすのはこちら。広告宣伝を含むメールでは必須。
 *  - List-Unsubscribe(不可視ヘッダ): Gmail等が差出人名の横に配信停止ボタンを出す。迷惑メール報告の
 *                          代わりに押してもらう逃し弁で、苦情率＝ドメイン評価を守るのはこちら。
 *
 * 法律上の該当性は「送信通数」ではなく内容が広告宣伝目的かで決まるため、一括送信でも純粋なお礼・
 * 業務連絡のみなら本文フッターは不要。ただし一括では到達性のためヘッダは常に付ける(header_only)。
 */

/** 一括送信時の配信停止の付け方。 */
export type UnsubMode = "full" | "header_only";

export const UNSUB_MODE_LABEL: Record<UnsubMode, string> = {
  full: "広告宣伝を含む（資料・サービス紹介・セミナー案内など）",
  header_only: "純粋なお礼・業務連絡のみ",
};

export const UNSUB_MODE_HINT: Record<UnsubMode, string> = {
  full: "本文末尾に配信停止リンクを付けます（特定電子メール法の表示義務）。迷ったらこちら。",
  header_only: "本文はそのまま（フッターなし）。Gmail等が表示する配信停止ボタン用のヘッダのみ付けます。",
};

/** 本文フッターを付けるか。 */
export function wantsFooter(mode: UnsubMode): boolean {
  return mode === "full";
}

export interface AdSignal {
  /** 判定の種類 */
  key: string;
  /** 画面に出す説明 */
  label: string;
  /** 実際に一致した箇所(抜粋) */
  hit: string;
}

const AD_PATTERNS: { key: string; label: string; re: RegExp }[] = [
  { key: "seminar", label: "セミナー・ウェビナーの案内", re: /セミナー|ウェビナー|勉強会|説明会/ },
  { key: "campaign", label: "キャンペーン・特典・無料訴求", re: /キャンペーン|割引|特典|無料[^通]|モニター募集/ },
  { key: "material", label: "資料・カタログの案内", re: /資料|カタログ|パンフレット|ホワイトペーパー|事例集/ },
  { key: "product", label: "サービス・製品の紹介", re: /サービス(?:の)?(?:ご)?(?:紹介|案内|概要)|製品|ソリューション|導入事例|新機能|リリース/ },
  { key: "meeting", label: "デモ・商談機会の打診", re: /デモ|ご説明(?:の機会|も承|いたします)|ご提案|お打ち合わせの機会|商談/ },
];

const URL_RE = /https?:\/\/[^\s<>"')]+/;

/**
 * 本文・件名から「広告宣伝にあたりうる要素」を検出する。
 * 法的判断そのものではなく、header_only を選んだ人への注意喚起に使う。
 * ガイドライン上は広告宣伝の内容が一部でも含まれれば特定電子メールに該当するため、
 * 1つでも当たれば full を勧める。
 */
export function detectAdSignals(subject: string, body: string): AdSignal[] {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  const out: AdSignal[] = [];
  const url = text.match(URL_RE);
  if (url) out.push({ key: "url", label: "本文中のURL（サイト・資料への誘導）", hit: url[0].slice(0, 60) });
  for (const p of AD_PATTERNS) {
    const m = text.match(p.re);
    if (m) out.push({ key: p.key, label: p.label, hit: m[0] });
  }
  return out;
}

/** 注意喚起が必要か(header_only を選んでいるのに広告要素がある)。 */
export function needsAdWarning(mode: UnsubMode, subject: string, body: string): boolean {
  return mode === "header_only" && detectAdSignals(subject, body).length > 0;
}
