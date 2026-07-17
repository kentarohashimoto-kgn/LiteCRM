/**
 * タスクビュー用の軽量ビューモデル。サーバー→クライアント境界を跨ぐため
 * シリアライズ可能なプリミティブのみで構成する。
 */
export interface TaskVM {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  assigned_to?: string | null;
  section_id?: string | null;
  project_id?: string | null;
  opportunity_id?: string | null;
  sort_order?: number;
  projectName?: string | null;
  projectColor?: string | null;
  accountName?: string | null;
  labels?: string[];
  /** カード色（COLOR_KEYS のキー）。未設定は既定（優先度に応じた淡色）。 */
  color?: string | null;
  /** タスクの説明（自由記述）。 */
  description?: string | null;
  /** 参照URL（資料/関連ページ等の任意リンク）。 */
  url?: string | null;
  /** マイルストーン（期日の一点イベント。タイムラインで◆表示）。 */
  is_milestone?: boolean;
  /** サブタスクの親（1階層のみ）。 */
  parent_task_id?: string | null;
  /** 親タスクのタイトル（サブタスクの表示用パンくず）。 */
  parentTitle?: string | null;
  /** 繰り返しルール。null=繰り返しなし。 */
  recurrence?: import("@/lib/recurrence").Recurrence | null;
  /** サブタスク進捗（表示用に親タスクへ付与する派生値）。 */
  subDone?: number;
  subTotal?: number;
  /** コメント数（F-203。表示用の派生値）。 */
  commentCount?: number;
}

/** 依存関係（先行→後続）のクライアント境界用ビューモデル。 */
export interface DepVM {
  id: string;
  predecessor_task_id: string;
  successor_task_id: string;
}

export interface UserVM {
  id: string;
  name: string;
  avatarColor?: string;
}

export interface SectionVM {
  id: string;
  name: string;
}

export const NO_SECTION = "__none__";

export function isOverdue(t: TaskVM, today: string): boolean {
  return t.status !== "done" && !!t.due_date && t.due_date < today;
}

export function sortTasks(a: TaskVM, b: TaskVM): number {
  const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (so !== 0) return so;
  const ad = a.due_date ?? "9999-12-31";
  const bd = b.due_date ?? "9999-12-31";
  if (ad !== bd) return ad.localeCompare(bd);
  return a.title.localeCompare(b.title);
}

/** 期日の相対表記（今日/明日/M月D日/曜日つき）。 */
export function relDue(due: string | null | undefined, today: string): { label: string; tone: "over" | "today" | "soon" | "none" | "far" } {
  if (!due) return { label: "期日なし", tone: "none" };
  if (due < today) return { label: fmt(due), tone: "over" };
  if (due === today) return { label: "今日", tone: "today" };
  const t = new Date(today + "T00:00:00");
  const d = new Date(due + "T00:00:00");
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 1) return { label: "明日", tone: "soon" };
  if (diff <= 6) return { label: fmt(due), tone: "soon" };
  return { label: fmt(due), tone: "far" };
}

function fmt(d: string): string {
  const [, m, day] = d.split("-");
  return `${Number(m)}月${Number(day)}日`;
}
