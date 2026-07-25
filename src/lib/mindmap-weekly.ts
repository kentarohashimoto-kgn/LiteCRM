/**
 * 週次予定マインドマップの自動生成(純ロジック)。
 * docs/MINDMAP_DESIGN_2026-07.md §4
 *
 * 入力: Googleカレンダー予定 / CRMのアポ・商談 / 今月・来月クロージング予定 / 期日タスク / 週次報告
 * 出力: マインドマップのノード仕様ツリー(NodeSpec)
 *
 * ここは「決定的(ルールベース)」に閉じる。APIキー無し・カレンダー未接続でも必ず動くのが要件。
 * AIによる補強は上位(server action)で任意に上乗せする。
 */

import type { NodeMarker, NodeRefType } from "@/lib/mindmap";

export interface NodeSpec {
  title: string;
  note?: string | null;
  marker?: NodeMarker;
  /** 明示的な色。未指定なら第1階層の自動配色を継承する。 */
  color?: string | null;
  due_date?: string | null;
  ref_type?: NodeRefType;
  ref_id?: string | null;
  ref_url?: string | null;
  collapsed?: boolean;
  children?: NodeSpec[];
}

/**
 * 予定の分類。日付の下をこの単位でまとめ、開きすぎずに全体を把握できるようにする。
 *   meeting  = 商談・アポ(CRM由来、またはカレンダーでCRM顧客に紐づいたもの)
 *   calendar = 上記以外の業務予定(研修・展示会・社内MTGなど)
 *   other    = 移動・休憩・私用など、段取り上ノイズになるもの
 */
export type EventCategory = "meeting" | "calendar" | "other";

/**
 * 「その他」に落とす予定のタイトル。実カレンダーを見て決めた実務的なルール。
 * (ランチ休憩・ジム・移動・出社などが商談と同列に並ぶと週の全体像が読めなくなる)
 */
const OTHER_PATTERNS =
  /ランチ|昼食|休憩|ジム|筋トレ|移動|出社|退社|通院|病院|散髪|美容室|予定なし|ブロック|作業時間|集中|バッファ|私用|有給|誕生日/;

/** 商談・アポらしさを示す語(CRMに紐づかなくても商談として扱う)。 */
const MEETING_PATTERNS = /商談|打合せ|打ち合わせ|お打ち合わせ|訪問|来社|アポ|面談|MTG|Mtg|ミーティング|予約スケジュール|予約訪問|訪問予約/;

/** 予定を分類する。CRM紐づきが最優先、次にタイトルのパターン。 */
export function classifyEvent(e: {
  source: "calendar" | "crm";
  title: string;
  opportunityId: string | null;
  accountName: string | null;
}): EventCategory {
  if (e.source === "crm" || e.opportunityId) return "meeting";
  if (OTHER_PATTERNS.test(e.title)) return "other";
  if (e.accountName || MEETING_PATTERNS.test(e.title)) return "meeting";
  return "calendar";
}

/** 週内の予定(カレンダー予定・CRMのアポ/商談を統合したもの)。 */
export interface WeeklyEvent {
  id: string;
  title: string;
  /** JST の YYYY-MM-DD */
  date: string;
  /** ISO日時。終日/時刻未定は null */
  startAt: string | null;
  endAt: string | null;
  source: "calendar" | "crm";
  accountName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  /** 案件のステージ(準備項目の推定に使う) */
  stage: string | null;
  yomi: string | null;
  url: string | null;
}

/** 今月・来月のクロージング予定(売上ヨミ)。 */
export interface WeeklyDeal {
  id: string;
  name: string;
  accountName: string | null;
  amount: number;
  probability: number | null;
  yomi: string | null;
  stage: string | null;
  expectedCloseDate: string | null;
  nextAction: string | null;
  ownerName: string | null;
}

export interface WeeklyTask {
  id: string;
  title: string;
  dueDate: string;
  status: string;
  accountName: string | null;
  opportunityId: string | null;
}

export interface WeeklySource {
  /** 対象週の月曜 YYYY-MM-DD */
  weekStart: string;
  events: WeeklyEvent[];
  deals: WeeklyDeal[];
  tasks: WeeklyTask[];
  repPlan: { nextWeekPlan: string | null; monthAheadPlan: string | null } | null;
  calendarConnected: boolean;
}

const DOW = ["月", "火", "水", "木", "金", "土", "日"];

/**
 * 1枝あたりの表示上限。
 * 実データでは「期限超過タスク168件」「月末締切タスク122件」のような塊が普通にあり、
 * 1件1ノードで展開すると数百ノード・縦2万pxの読めないマップになる(実測416ノード)。
 * 上限を超えた分は「他N件」の1ノードに畳み、詳細は元画面(タスク/案件一覧)で見る方針。
 */
export const LIMITS = {
  dayEvents: 12,
  dayTasks: 10,
  overdueTasks: 15,
  noTouchDeals: 12,
  noNextAction: 12,
  dealsPerMonth: 12,
  sequences: 10,
  overlaps: 10,
  prepEvents: 6,
} as const;

/** この数を超える子を持つ枝は既定で折り畳む(開いた直後に全体像が見える状態にする)。 */
export const COLLAPSE_OVER = 8;

/** 上限を超えた分を「他N件」ノードにまとめる。 */
function capped(items: NodeSpec[], max: number, moreLabel: (rest: number) => string): NodeSpec[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), { title: moreLabel(items.length - max) }];
}

/**
 * 子が多い枝を既定で折り畳む(ルートは常に開く)。
 * 生成直後は「週の全体像」が1画面で見え、必要な枝だけ開いて掘る運用にする。
 */
export function autoCollapse(spec: NodeSpec, depth = 0): NodeSpec {
  const children = (spec.children ?? []).map((c) => autoCollapse(c, depth + 1));
  return {
    ...spec,
    collapsed: depth > 0 ? spec.collapsed || children.length > COLLAPSE_OVER : false,
    children,
  };
}

/** YYYY-MM-DD に日数を足す(タイムゾーンに依存しない純計算)。 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 週の7日分(月〜日)の YYYY-MM-DD。 */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** 「7/27(月)」形式のラベル。 */
export function dayLabel(date: string, index: number): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}(${DOW[index % 7]})`;
}

/** ISO日時 → JSTの HH:MM。 */
export function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

/** YYYY-MM の月ラベル。 */
function monthLabel(ym: string): string {
  const [, m] = ym.split("-");
  return `${Number(m)}月`;
}

function yen(amount: number): string {
  if (!amount) return "";
  const man = Math.round(amount / 10000);
  return man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${man.toLocaleString("ja-JP")}万円`;
}

/* ------------------------------------------------------------------ */
/* 段取り検出ルール                                                    */
/* ------------------------------------------------------------------ */

/** ステージ・ヨミから、その予定の前にやるべき定型準備を返す。 */
export function prepForStage(stage: string | null, yomi: string | null): string[] {
  const s = stage ?? "";
  const y = yomi ?? "";
  if (["verbal_commit", "internal_review"].includes(s) || /^0\.|^1\./.test(y)) {
    return ["契約書・発注書の条件確認", "決裁者の同席可否を確認", "納品体制・開始日の握り"];
  }
  if (["proposal_sent", "proposal_preparing"].includes(s) || /^2\./.test(y)) {
    return ["提案書の最終確認", "見積・稟議ルートの確認", "想定される反論への回答準備"];
  }
  if (["needs_confirmed", "meeting_done"].includes(s) || /^3\./.test(y)) {
    return ["課題・予算・時期の再確認項目を整理", "事例(近い業種)の持参"];
  }
  if (["lead_acquired", "contacted", "meeting_scheduled"].includes(s) || /^4\./.test(y)) {
    return ["事前調査(HP・IR・ニュース・課題仮説)", "ヒアリング項目の準備", "会社紹介・実績資料の用意"];
  }
  return [];
}

/** 同じ日で時間帯が重なる予定の組を返す(予定重複の検出)。 */
export function detectOverlaps(events: WeeklyEvent[]): { a: WeeklyEvent; b: WeeklyEvent }[] {
  const out: { a: WeeklyEvent; b: WeeklyEvent }[] = [];
  const timed = events.filter((e) => e.startAt);
  const byDate = new Map<string, WeeklyEvent[]>();
  for (const e of timed) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  for (const list of byDate.values()) {
    const sorted = [...list].sort((x, y) => (x.startAt ?? "").localeCompare(y.startAt ?? ""));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const aStart = new Date(a.startAt as string).getTime();
        const aEnd = a.endAt ? new Date(a.endAt).getTime() : aStart + 60 * 60 * 1000;
        const bStart = new Date(b.startAt as string).getTime();
        if (bStart < aEnd && bStart >= aStart) out.push({ a, b });
      }
    }
  }
  return out;
}

/** 同一顧客で週内に2件以上の予定 → 前後関係(宿題の連携)の候補。 */
export function detectSequences(events: WeeklyEvent[]): { account: string; events: WeeklyEvent[] }[] {
  const byAccount = new Map<string, WeeklyEvent[]>();
  for (const e of events) {
    const key = e.accountName ?? "";
    if (!key) continue;
    const list = byAccount.get(key) ?? [];
    list.push(e);
    byAccount.set(key, list);
  }
  const out: { account: string; events: WeeklyEvent[] }[] = [];
  for (const [account, list] of byAccount) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) =>
      (a.date + (a.startAt ?? "")).localeCompare(b.date + (b.startAt ?? "")),
    );
    out.push({ account, events: sorted });
  }
  return out.sort((a, b) => a.account.localeCompare(b.account));
}

/** 比較用にタイトルを正規化(時刻・記号・空白を落とす)。 */
function normTitle(s: string): string {
  return s
    .replace(/\d{1,2}[:：]\d{2}/g, "")
    .replace(/[\s　（）()【】｜|・:：\-–—]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * 予定と同じ内容のタスクを除く。
 * アポ登録時に次アクションタスクが自動生成されるため、そのままだと
 * 「09:30 ブラザー工業 初回商談(アポ)」と「タスク: 初回商談(アポ) 09:30」が並んで出る。
 */
export function dedupeTasksAgainstEvents(tasks: WeeklyTask[], events: WeeklyEvent[]): WeeklyTask[] {
  const byDate = new Map<string, string[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(normTitle(e.title));
    byDate.set(e.date, list);
  }
  return tasks.filter((t) => {
    const titles = byDate.get(t.dueDate);
    if (!titles) return true;
    const n = normTitle(t.title);
    if (n.length < 3) return true; // 短すぎる語での誤一致を避ける
    return !titles.some((e) => e.includes(n) || n.includes(e));
  });
}

/** 対象月(YYYY-MM)のクロージング予定を金額降順で。 */
export function dealsForMonth(deals: WeeklyDeal[], ym: string): WeeklyDeal[] {
  return deals
    .filter((d) => (d.expectedCloseDate ?? "").slice(0, 7) === ym)
    .sort((a, b) => b.amount - a.amount);
}

/** 案件が週内の予定に登場しているか(接点の有無)。 */
function hasTouchThisWeek(deal: WeeklyDeal, events: WeeklyEvent[]): boolean {
  return events.some(
    (e) =>
      (deal.id && e.opportunityId === deal.id) ||
      (!!deal.accountName && !!e.accountName && e.accountName === deal.accountName) ||
      (!!deal.accountName && e.title.includes(deal.accountName)),
  );
}

/**
 * 「事前にやるべきこと」の枝を組み立てる。
 * 漏れ検出(接点なし・次アクション未設定・予定重複・遅延タスク)を先頭に、
 * その後に個別案件の定型準備を並べる。
 */
export function buildPrepBranch(src: WeeklySource, months: string[]): NodeSpec {
  const children: NodeSpec[] = [];

  // ① 今月・来月クロージング予定なのに今週の接点が無い
  const noTouch: NodeSpec[] = [];
  for (const ym of months) {
    for (const d of dealsForMonth(src.deals, ym)) {
      if (hasTouchThisWeek(d, src.events)) continue;
      // 「日程を打診する」は子ノードにせず注記に畳む(1件2ノードになるのを避ける)
      noTouch.push({
        title: `${d.accountName ?? "顧客未設定"}｜${d.name}`,
        note: `今週中に日程を打診 / ${yen(d.amount)}${d.probability != null ? ` / 確度${d.probability}%` : ""}${
          d.expectedCloseDate ? ` / 着地${d.expectedCloseDate}` : ""
        }`,
        marker: "alert",
        ref_type: "opportunity",
        ref_id: d.id,
        ref_url: `/app/opportunities/${d.id}`,
      });
    }
  }
  if (noTouch.length > 0) {
    children.push({
      title: `今週接点なしのクロージング予定 ${noTouch.length}件`,
      marker: "alert",
      children: capped(noTouch, LIMITS.noTouchDeals, (r) => `他${r}件（案件一覧で確認）`),
    });
  }

  // ② 次アクション未設定
  const noNext = months
    .flatMap((ym) => dealsForMonth(src.deals, ym))
    .filter((d) => !d.nextAction || !d.nextAction.trim())
    .map<NodeSpec>((d) => ({
      title: `${d.accountName ?? "顧客未設定"}｜${d.name}`,
      marker: "p1",
      ref_type: "opportunity",
      ref_id: d.id,
      ref_url: `/app/opportunities/${d.id}`,
    }));
  if (noNext.length > 0) {
    children.push({
      title: `次アクション未設定 ${noNext.length}件`,
      marker: "alert",
      children: capped(noNext, LIMITS.noNextAction, (r) => `他${r}件（案件一覧で確認）`),
    });
  }

  // ③ 予定の重複
  const overlaps = detectOverlaps(src.events);
  if (overlaps.length > 0) {
    children.push({
      title: `予定が重複 ${overlaps.length}件 → 調整`,
      marker: "alert",
      children: capped(
        overlaps.map((o) => ({
          title: `${dayLabelOf(o.a.date, src.weekStart)} ${timeLabel(o.a.startAt)} ${o.a.title} ⇔ ${timeLabel(
            o.b.startAt,
          )} ${o.b.title}`,
        })),
        LIMITS.overlaps,
        (r) => `他${r}件`,
      ),
    });
  }

  // ④ 期日超過タスク(古い順に効いてくるので、期日が古いものから見せる)
  const overdue = src.tasks
    .filter((t) => t.dueDate < src.weekStart && t.status !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (overdue.length > 0) {
    children.push({
      title: `期日超過タスク ${overdue.length}件`,
      marker: "p1",
      children: capped(
        overdue.map((t) => ({
          title: `(遅延 ${t.dueDate}) ${t.title}`,
          due_date: t.dueDate,
          marker: "p1" as NodeMarker,
          ref_type: "task" as NodeRefType,
          ref_id: t.id,
        })),
        LIMITS.overdueTasks,
        (r) => `他${r}件（タスク一覧で確認）`,
      ),
    });
  }

  // ⑤ 同一顧客の前後関係(宿題の受け渡し)
  const seqs = detectSequences(src.events);
  if (seqs.length > 0) {
    children.push({
      title: "同じ顧客で週内に複数予定（前後関係の確認）",
      marker: "flag",
      // 宿題の受け渡しは1行で足りるので注記に畳む(顧客ごと2ノードにしない)
      children: capped(
        seqs.map((s) => ({
          title: s.account,
          marker: "flag" as NodeMarker,
          note: `${dayLabelOf(s.events[0].date, src.weekStart)} の宿題を ${dayLabelOf(
            s.events[s.events.length - 1].date,
            src.weekStart,
          )} までに提出`,
        })),
        LIMITS.sequences,
        (r) => `他${r}件`,
      ),
    });
  }

  // ⑥ 今週の予定ごとの定型準備(ステージ・ヨミ別)
  const perEvent: NodeSpec[] = [];
  for (const e of src.events) {
    if (perEvent.length >= LIMITS.prepEvents) break;
    const items = prepForStage(e.stage, e.yomi);
    if (items.length === 0) continue;
    perEvent.push({
      title: `${dayLabelOf(e.date, src.weekStart)} ${e.accountName ?? e.title}`,
      ref_type: e.opportunityId ? "opportunity" : "none",
      ref_id: e.opportunityId,
      ref_url: e.opportunityId ? `/app/opportunities/${e.opportunityId}` : null,
      children: items.map((t) => ({ title: t, marker: "p2" as NodeMarker })),
    });
  }
  if (perEvent.length > 0) {
    children.push({ title: "商談ごとの準備（ステージ別）", children: perEvent });
  }

  if (children.length === 0) {
    children.push({ title: "検出された漏れはありません（手で追加してください）" });
  }
  return { title: "事前準備（今週の仕込み）", children };
}

function dayLabelOf(date: string, weekStart: string): string {
  const idx = weekDays(weekStart).indexOf(date);
  return idx >= 0 ? dayLabel(date, idx) : date;
}

/* ------------------------------------------------------------------ */
/* ルートツリー                                                        */
/* ------------------------------------------------------------------ */

/** 週次予定マインドマップのノードツリーを組み立てる。 */
export function buildWeeklyMindmap(input: WeeklySource): NodeSpec {
  // アポ登録で自動生成された「予定と同じ内容のタスク」を先に落とす
  const src: WeeklySource = { ...input, tasks: dedupeTasksAgainstEvents(input.tasks, input.events) };
  const days = weekDays(src.weekStart);
  const thisMonth = src.weekStart.slice(0, 7);
  const nextMonth = addDays(`${thisMonth}-01`, 32).slice(0, 7);
  const months = [thisMonth, nextMonth];

  const children: NodeSpec[] = [buildPrepBranch(src, months)];

  // 1日1枝
  days.forEach((date, i) => {
    const dayEvents = src.events
      .filter((e) => e.date === date)
      .sort((a, b) => (a.startAt ?? "99").localeCompare(b.startAt ?? "99"));
    const dayTasks = src.tasks.filter((t) => t.dueDate === date && t.status !== "done");

    // 日付の下は 商談 / タスク / カレンダー / その他 の4分類にまとめる。
    // 予定を全部フラットに並べると、1日20件超で週の全体像が読めなくなるため。
    const eventNode = (e: WeeklyEvent, withPrep: boolean): NodeSpec => {
      const time = timeLabel(e.startAt);
      const head = [time, e.accountName ?? "", e.title].filter(Boolean).join(" ");
      const prep = withPrep ? prepForStage(e.stage, e.yomi) : [];
      return {
        title: head.slice(0, 200),
        note: e.source === "calendar" ? "Googleカレンダー" : "CRM",
        ref_type: (e.opportunityId ? "opportunity" : "calendar") as NodeRefType,
        ref_id: e.opportunityId,
        ref_url: e.opportunityId ? `/app/opportunities/${e.opportunityId}` : e.url,
        children: prep.slice(0, 2).map((t) => ({ title: t, marker: "p3" as NodeMarker })),
      };
    };

    const byCategory = { meeting: [] as WeeklyEvent[], calendar: [] as WeeklyEvent[], other: [] as WeeklyEvent[] };
    for (const e of dayEvents) byCategory[classifyEvent(e)].push(e);

    const groups: NodeSpec[] = [];
    if (byCategory.meeting.length > 0) {
      groups.push({
        title: `商談 ${byCategory.meeting.length}件`,
        children: capped(
          byCategory.meeting.map((e) => eventNode(e, true)),
          LIMITS.dayEvents,
          (r) => `他${r}件`,
        ),
      });
    }
    if (dayTasks.length > 0) {
      groups.push({
        title: `タスク ${dayTasks.length}件`,
        children: capped(
          dayTasks.map((t) => ({
            title: t.title,
            due_date: t.dueDate,
            marker: "p2" as NodeMarker,
            ref_type: "task" as NodeRefType,
            ref_id: t.id,
          })),
          LIMITS.dayTasks,
          (r) => `他${r}件（タスク一覧で確認）`,
        ),
      });
    }
    if (byCategory.calendar.length > 0) {
      groups.push({
        title: `カレンダー ${byCategory.calendar.length}件`,
        children: capped(
          byCategory.calendar.map((e) => eventNode(e, false)),
          LIMITS.dayEvents,
          (r) => `他${r}件`,
        ),
      });
    }
    if (byCategory.other.length > 0) {
      groups.push({
        title: `その他 ${byCategory.other.length}件`,
        collapsed: true, // 移動・休憩などは既定で畳む
        children: capped(
          byCategory.other.map((e) => eventNode(e, false)),
          LIMITS.dayEvents,
          (r) => `他${r}件`,
        ),
      });
    }

    children.push({
      title: dayLabel(date, i),
      collapsed: groups.length === 0,
      children: groups.length > 0 ? groups : [{ title: "予定なし" }],
    });
  });

  // クロージング予定(今月・来月)
  for (const ym of months) {
    const list = dealsForMonth(src.deals, ym);
    const total = list.reduce((s, d) => s + d.amount, 0);
    children.push({
      title: `${ym === thisMonth ? "今月" : "来月"}クロージング（${monthLabel(ym)}・${list.length}件 ${yen(total)}）`,
      collapsed: list.length === 0,
      children:
        list.length > 0
          ? capped(
              // 次アクションは子ノードにせず注記に入れる(案件数×2ノードになるのを避ける)
              list.map((d) => ({
                title: `${d.accountName ?? "顧客未設定"}｜${d.name}`,
                note: [
                  yen(d.amount),
                  d.probability != null ? `確度${d.probability}%` : "",
                  d.yomi ?? "",
                  d.expectedCloseDate ? `着地${d.expectedCloseDate}` : "",
                  d.ownerName ? `担当${d.ownerName}` : "",
                  d.nextAction ? `次: ${d.nextAction}` : "次アクション未設定",
                ]
                  .filter(Boolean)
                  .join(" / "),
                due_date: d.expectedCloseDate,
                marker: (d.nextAction ? "none" : "alert") as NodeMarker,
                ref_type: "opportunity" as NodeRefType,
                ref_id: d.id,
                ref_url: `/app/opportunities/${d.id}`,
              })),
              LIMITS.dealsPerMonth,
              (r) => `他${r}件（案件一覧で確認）`,
            )
          : [{ title: "対象なし" }],
    });
  }

  // 週次報告のナラティブ
  if (src.repPlan && (src.repPlan.nextWeekPlan || src.repPlan.monthAheadPlan)) {
    const kids: NodeSpec[] = [];
    if (src.repPlan.nextWeekPlan) {
      kids.push({
        title: "来週の予定（週次報告）",
        children: splitLines(src.repPlan.nextWeekPlan).map((t) => ({ title: t })),
      });
    }
    if (src.repPlan.monthAheadPlan) {
      kids.push({
        title: "1ヶ月先の行動予定（週次報告）",
        children: splitLines(src.repPlan.monthAheadPlan).map((t) => ({ title: t })),
      });
    }
    children.push({ title: "週次報告メモ", collapsed: true, children: kids });
  }

  if (!src.calendarConnected) {
    children.push({
      title: "Googleカレンダー未連携（CRMのみで生成）",
      marker: "alert",
      note:
        "設定 → Googleカレンダー連携 に「非公開URL(iCal形式)」を貼ると、" +
        "この枝の代わりに実際の予定が1日ごとに入ります。",
      ref_type: "none",
      ref_url: "/app/settings",
    });
  }

  const [, m, d] = src.weekStart.split("-").map(Number);
  // 子が多い枝は畳んだ状態で返す(開いた直後に週の全体像が1画面で見える)
  return autoCollapse({ title: `${m}/${d}週の予定`, children });
}

/** 複数行テキストを箇条書きノード用に分割(最大20行)。 */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*・\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* テンプレート(研修・セミナー構成)                                    */
/* ------------------------------------------------------------------ */

/** 研修/セミナーの構成検討テンプレート(ユースケース②の出発点)。 */
export function seminarTemplate(title: string): NodeSpec {
  return {
    title: title || "新しい研修・セミナー",
    children: [
      {
        title: "ゴール・KGI",
        children: [{ title: "受講後にできるようになること" }, { title: "商談化・受注への接続" }],
      },
      {
        title: "対象者",
        children: [{ title: "役職・部門" }, { title: "前提知識" }, { title: "人数・形式（対面/オンライン）" }],
      },
      { title: "現状の課題（顧客の言葉で）", children: [{ title: "課題1" }, { title: "課題2" }] },
      {
        title: "全体構成",
        children: [
          { title: "1. つかみ（現状と危機感）", children: [{ title: "事例・データ" }] },
          { title: "2. 原理（なぜそうなるか）" },
          { title: "3. 実演（デモ）" },
          { title: "4. 演習（手を動かす）" },
          { title: "5. 明日からの行動" },
        ],
      },
      { title: "演習・ワーク", children: [{ title: "課題設定" }, { title: "所要時間" }, { title: "配布物" }] },
      { title: "持ち帰り資料", children: [{ title: "スライドPDF" }, { title: "プロンプト集・チェックリスト" }] },
      { title: "集客・告知", children: [{ title: "告知文" }, { title: "案内先リスト" }, { title: "申込導線" }] },
      { title: "当日運営", children: [{ title: "タイムテーブル" }, { title: "機材・接続確認" }, { title: "役割分担" }] },
      { title: "フォロー", children: [{ title: "アンケート" }, { title: "個別相談の打診" }, { title: "商談化の確認" }] },
    ],
  };
}
