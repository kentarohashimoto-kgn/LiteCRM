/**
 * スライド作成の純粋ロジック。
 *
 * 構成案(Claudeの出力)の受け取り・検証と、1枚ずつの画像プロンプトの組み立て。
 * DBもプロバイダも触らないので、境界値と壊れた出力の扱いをテストで固定できる。
 */

/** 1デッキの上限枚数。研修環境なので、時間と実費が読める範囲に抑える。 */
export const MAX_SLIDES = 10;
export const MIN_SLIDES = 1;
/** 既定の枚数(指示に枚数の指定が無いとき)。 */
export const DEFAULT_SLIDES = 8;

/**
 * 画像の品質。既定は medium。
 * low は文字が崩れやすく、high は単価が medium の約4倍になる。
 * high だけは1人1日の枚数制限をかける(limits.ts)。
 */
export const DEFAULT_SLIDE_QUALITY = "medium" as const;
export type SlideQuality = "low" | "medium" | "high";

export const SLIDE_QUALITIES: readonly SlideQuality[] = ["low", "medium", "high"] as const;

export function isSlideQuality(value: unknown): value is SlideQuality {
  return typeof value === "string" && (SLIDE_QUALITIES as readonly string[]).includes(value);
}

/** 指定が無い・不正なら既定へ寄せる。画面からの値をそのまま信じない。 */
export function toSlideQuality(value: unknown, fallback: SlideQuality = DEFAULT_SLIDE_QUALITY): SlideQuality {
  return isSlideQuality(value) ? value : fallback;
}

/** 画面に出す画質の説明。1枚あたりの目安(1ドル150円換算)を添える。 */
export const SLIDE_QUALITY_LABELS: Record<SlideQuality, { label: string; hint: string }> = {
  low: { label: "低（速い・約1円/枚）", hint: "下書き向け。文字が崩れることがあります" },
  medium: { label: "標準（約8円/枚）", hint: "提案書にそのまま使える品質です" },
  high: { label: "高（約32円/枚）", hint: "最終納品物向け。1人1日10枚までです" },
};

export interface SlidePlanItem {
  title: string;
  summary: string;
  imagePrompt: string;
  notes: string;
}

export interface SlidePlan {
  title: string;
  styleGuide: string;
  slides: SlidePlanItem[];
}

const MAX_TITLE = 120;
const MAX_SUMMARY = 400;
const MAX_PROMPT = 4000;
const MAX_NOTES = 2000;

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+$/g, "").slice(0, max);
}

/**
 * Claude が返した構成案を受け取る。
 *
 * モデルの出力は前後に説明文やコードフェンスが付くことがあるため、最初の JSON らしき塊を拾う。
 * 1枚も取れなければ null を返し、呼び出し側でやり直しの案内を出す
 * (壊れた構成案のまま画像生成に進むと、実費をかけて無駄なものを作ってしまう)。
 */
export function parseSlidePlan(raw: string, max = MAX_SLIDES): SlidePlan | null {
  const json = extractJsonObject(raw);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as { title?: unknown; styleGuide?: unknown; slides?: unknown };
  const rawSlides = Array.isArray(obj.slides) ? obj.slides : [];

  const slides: SlidePlanItem[] = [];
  for (const s of rawSlides) {
    if (!s || typeof s !== "object") continue;
    const item = s as Record<string, unknown>;
    const imagePrompt = str(item.imagePrompt, MAX_PROMPT);
    const title = str(item.title, MAX_TITLE);
    // 画像を作る文章が無いスライドは、生成しても白紙になるだけなので落とす。
    if (!imagePrompt && !title) continue;
    slides.push({
      title: title || `スライド${slides.length + 1}`,
      summary: str(item.summary, MAX_SUMMARY),
      imagePrompt: imagePrompt || title,
      notes: str(item.notes, MAX_NOTES),
    });
    if (slides.length >= max) break;
  }
  if (slides.length === 0) return null;

  return {
    title: str(obj.title, MAX_TITLE) || "無題のスライド",
    styleGuide: str(obj.styleGuide, MAX_PROMPT),
    slides,
  };
}

/** 前後の説明文やコードフェンスを剥がして、最初の JSON オブジェクトだけを取り出す。 */
export function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/** 指示に「10枚で」等の枚数指定があれば拾う。無ければ既定値。 */
export function requestedSlideCount(instruction: string, fallback = DEFAULT_SLIDES): number {
  const m = (instruction ?? "").match(/(\d+)\s*(?:枚|ページ|スライド|slides?|pages?)/i);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return clampSlideCount(n);
}

export function clampSlideCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SLIDES;
  return Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Math.floor(n)));
}

/** 構成案づくりでClaudeに渡す指示。JSONだけを返させる。 */
export function buildPlanInstruction(instruction: string, count: number): string {
  return [
    "あなたは提案書スライドの構成を設計します。",
    `添付のデザインガイド（画像）と資料をもとに、**${count}枚**のスライド構成を作ってください。`,
    "",
    "## 受講者の指示",
    instruction.trim() || "（特になし。資料の内容から適切に構成してください）",
    "",
    "## 出力形式",
    "説明や前置きを書かず、次の形の JSON だけを返してください。",
    "",
    "```json",
    "{",
    '  "title": "デッキ全体のタイトル",',
    '  "styleGuide": "デザインガイドから読み取ったトンマナを、画像生成モデルへの指示として日本語で200〜400字にまとめたもの",',
    '  "slides": [',
    '    { "title": "スライドの見出し", "summary": "このスライドで伝えること(1〜2文)", "imagePrompt": "このスライド1枚を画像として生成するための指示", "notes": "発表者ノート" }',
    "  ]",
    "}",
    "```",
    "",
    "## 作り方の注意",
    "- `styleGuide` には、配色（具体的な色コード）・文字組・レイアウトの決まり・避けたい表現を書いてください。全スライドに毎回添えるので、これが揃っていないとページごとにバラつきます。",
    "- `imagePrompt` は、そのスライドに**実際に載せる日本語のテキスト（見出し・本文・数値）を明記**してください。画像の中に文字が描かれるので、書かれていない文字は出てきません。",
    "- レイアウト（左に見出し、右に図、下部に3カラムのカード等）も `imagePrompt` に書いてください。",
    "- 1ページ1メッセージにしてください。1枚に詰め込むと読めない画像になります。",
    `- スライドはちょうど ${count} 枚にしてください。`,
  ].join("\n");
}

/**
 * 1枚ぶんの画像プロンプト。
 *
 * トンマナは毎回添える。参照画像だけに頼るとページごとにブレるため、
 * 言語化したルールと画像の両方を渡して寄せる。
 */
export function buildSlideImagePrompt(params: {
  styleGuide: string | null;
  title: string;
  imagePrompt: string;
  position: number;
  total: number;
}): string {
  const parts = [
    `プレゼンテーション資料のスライド ${params.position}/${params.total} 枚目を、16:9 の画像として作成してください。`,
    "",
    "## このスライドの内容",
    params.imagePrompt.trim() || params.title,
  ];
  if (params.styleGuide?.trim()) {
    parts.push("", "## 全スライド共通のトンマナ（必ず従ってください）", params.styleGuide.trim());
  }
  parts.push(
    "",
    "## 必須条件",
    "- 添付した参考画像の配色・書体の印象・レイアウトの作法に合わせてください。",
    "- 文字は日本語で、指定された文言をそのまま正確に描いてください。誤字や意味の通らない文字を入れないでください。",
    "- スライド全面を使い、余白の外に白フチを作らないでください。",
  );
  return parts.join("\n");
}

/** 進捗の集計。画面の「7/10」とボタンの活性判定に使う。 */
export function slideProgress(items: { status: string }[]): {
  total: number;
  done: number;
  failed: number;
  pending: number;
  complete: boolean;
} {
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  return { total, done, failed, pending: total - done - failed, complete: total > 0 && done === total };
}

/** 次に生成すべきスライドの位置。無ければ null。 */
export function nextPendingPosition(items: { position: number; status: string }[]): number | null {
  const next = items
    .filter((i) => i.status !== "done")
    .sort((a, b) => a.position - b.position)[0];
  return next ? next.position : null;
}

/** 保存するファイル名。記号でストレージのパスを壊さないようにする。 */
export function pptxFileName(title: string): string {
  const base = (title || "スライド").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60);
  return `${base || "スライド"}.pptx`;
}
