/**
 * アポ前ファネル(リードの商談化プロセス)。
 * 新規リード → 相談候補(MQL) → 商談候補(SQL) → アポ獲得（→案件化）。
 * 別系統: 育成対象 / 対象外。File1 §2-3 準拠。
 */

export const FUNNEL_STAGES: { key: string; label: string; short: string; color: string; main: boolean }[] = [
  { key: "new", label: "新規リード", short: "新規", color: "bg-mist-soft text-ink/60", main: true },
  { key: "mql", label: "相談候補(MQL)", short: "相談候補", color: "bg-sky-100 text-sky-700", main: true },
  { key: "sql", label: "商談候補(SQL)", short: "商談候補", color: "bg-amber-100 text-amber-700", main: true },
  { key: "appointment", label: "アポ獲得", short: "アポ", color: "bg-teal-light text-teal-deep", main: true },
  { key: "nurturing", label: "育成対象", short: "育成", color: "bg-violet-100 text-violet-700", main: false },
  { key: "excluded", label: "対象外", short: "対象外", color: "bg-rose-50 text-rose-500", main: false },
];
export const FUNNEL_STAGE_MAP = Object.fromEntries(FUNNEL_STAGES.map((s) => [s.key, s]));
export const FUNNEL_MAIN = FUNNEL_STAGES.filter((s) => s.main); // 新規→相談候補→商談候補→アポ

/** 次の本流ステージ。 */
export function nextFunnelStage(stage: string): string | null {
  const order = FUNNEL_MAIN.map((s) => s.key);
  const i = order.indexOf(stage);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

/** 商談候補(SQL)へ上げる判定条件(File1 §3.2)。 */
export const SQL_CRITERIA = [
  "具体的な業務課題がある",
  "AI研修/AI顧問/開発/業務改善への関心がある",
  "導入時期が6か月以内",
  "予算または予算化の可能性がある",
  "決裁者または推進者と接点がある",
  "既存顧客・紹介・大手・横展開可能な企業",
  "開発/AIエージェント/RAG/AI-OCR/業務自動化に広がる可能性",
];
/** 育成対象に回す条件(File1 §3.3)。 */
export const NURTURE_CRITERIA = [
  "情報収集のみ", "予算がない", "導入時期が未定", "決裁者が不明", "課題が曖昧",
  "初回商談後に動きがない", "ウェビナー/展示会で接触しただけ", "返信はあるが商談化には早い",
];
