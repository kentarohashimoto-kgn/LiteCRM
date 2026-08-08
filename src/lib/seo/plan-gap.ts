import { benchmarkCtr } from "./benchmark";

/**
 * 記事プラン単位のギャップ集計（純関数・テスト対象）。
 *
 * SEOの提案は「KW1語」ではなく「記事1本」で出す。
 * 「生成AI研修」プランには27語がぶら下がっており、1語ずつ提案すると
 *   ・同じ記事の提案が27件並んで承認画面が読めなくなる
 *   ・承認するたびに別々の記事チケットが立ち、薄い記事が量産される
 *   ・1語ぶんの期待売上しか見えず、実際より小さく評価して見送ってしまう
 * の3つが同時に起きる。0187 で記事プラン（1記事=メインKW1つ+サブKW数語）を
 * 設計の単位にしたのに、提案生成だけがKW単位のまま残っていた。
 *
 * ここでプランに束ね直し、期待値はサブKW合計で評価する。
 */

/** seo_keyword_rankings RPC の1行（提案生成で使う列だけ）。 */
export interface KeywordRankingRow {
  keyword_id?: string | null;
  query?: string | null;
  intent_layer?: number | null;
  search_volume?: number | null;
  target_position_6m?: number | null;
  target_position_12m?: number | null;
  current_position?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  ranking_page?: string | null;
  gap_status?: string | null;
  article_plan_id?: string | null;
  plan_title?: string | null;
  plan_main_keyword?: string | null;
  plan_status?: string | null;
  planned_url?: string | null;
  plan_published_url?: string | null;
  is_existing_page?: boolean | null;
  difficulty?: number | null;
}

/** プランに含まれる狙う語1語ぶんのギャップ。 */
export interface PlanKeywordGap {
  query: string;
  volume: number;
  position: number | null;
  targetPosition: number;
  gapStatus: string;
  impressions: number;
  clicks: number;
  extraClicks: number;
  intentLayer: number | null;
  isMain: boolean;
}

/** 1提案＝1記事の候補。 */
export interface PlanCandidate {
  /** 記事プランに紐付いていないKWは null（1語=1提案のまま扱う） */
  planId: string | null;
  planTitle: string;
  mainKeyword: string;
  actionType: "new_article" | "rewrite" | "title_meta";
  targetPage: string;
  keywords: PlanKeywordGap[];
  totalExtraClicks: number;
  totalVolume: number;
  totalImpressions: number;
  layer1: boolean;
  difficulty: number | null;
  isExistingPage: boolean;
}

/**
 * 目標順位。6ヶ月目標を優先する。
 * 12ヶ月目標で期待値を出すと、半年先の理想値を「今月の見込み」として
 * 提示することになり、承認の判断材料として過大になる。
 */
export function targetPositionOf(row: KeywordRankingRow): number {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return n(row.target_position_6m) ?? n(row.target_position_12m) ?? 10;
}

/** 目標順位まで取れたときの追加クリック（月）。既に取れているぶんは引く。 */
export function extraClicksOf(row: KeywordRankingRow): number {
  const volume = Number(row.search_volume ?? 0);
  const clicks = Number(row.clicks ?? 0);
  const ctr = benchmarkCtr(targetPositionOf(row)) ?? 0.03;
  return Math.max(0, Math.round(volume * ctr - clicks));
}

/**
 * 打ち手はプランの状態から一意に決まる。
 *   対策ページが無い            → 新規記事
 *   ページはあるが10位圏外       → リライト（中身が検索意図に合っていない）
 *   ページがあり既に10位以内     → タイトル・説明文の改善（順位ではなくCTRの段階）
 */
function decideActionType(hasPage: boolean, bestPosition: number | null): PlanCandidate["actionType"] {
  if (!hasPage) return "new_article";
  if (bestPosition != null && bestPosition <= 10) return "title_meta";
  return "rewrite";
}

/**
 * 順位表の行を記事プラン単位に束ねる。
 * 伸びしろ（追加クリック）が0の語は落とす。既に目標を取れている語まで
 * 提案に混ぜると「やることが無い記事」が承認キューに並ぶため。
 */
export function groupGapsByPlan(rows: KeywordRankingRow[]): PlanCandidate[] {
  const buckets = new Map<string, PlanCandidate>();

  for (const row of rows) {
    const query = String(row.query ?? "").trim();
    if (!query) continue;
    if (row.plan_status === "dropped") continue;

    const extraClicks = extraClicksOf(row);
    if (extraClicks <= 0) continue;

    const planId = (row.article_plan_id as string) ?? null;
    const mainKeyword = String(row.plan_main_keyword ?? "") || query;
    // プラン未紐付けのKWは、そのKW単体を1つのグループとして扱う
    const key = planId ?? `kw:${query}`;
    const position = row.current_position == null ? null : Number(row.current_position);

    let b = buckets.get(key);
    if (!b) {
      const planned = String(row.planned_url ?? "").trim();
      const published = String(row.plan_published_url ?? "").trim();
      const targetPage = planned || published;
      b = {
        planId,
        planTitle: String(row.plan_title ?? "") || query,
        mainKeyword,
        actionType: "new_article",
        targetPage,
        keywords: [],
        totalExtraClicks: 0,
        totalVolume: 0,
        totalImpressions: 0,
        layer1: false,
        difficulty: row.difficulty == null ? null : Number(row.difficulty),
        isExistingPage: !!row.is_existing_page || !!targetPage,
      };
      buckets.set(key, b);
    }

    const intentLayer = row.intent_layer == null ? null : Number(row.intent_layer);
    b.keywords.push({
      query,
      volume: Number(row.search_volume ?? 0),
      position,
      targetPosition: targetPositionOf(row),
      gapStatus: String(row.gap_status ?? ""),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      extraClicks,
      intentLayer,
      isMain: query === mainKeyword,
    });
    b.totalExtraClicks += extraClicks;
    b.totalVolume += Number(row.search_volume ?? 0);
    b.totalImpressions += Number(row.impressions ?? 0);
    if (intentLayer === 1) b.layer1 = true;
    // 対策ページが未登録でも、実際に順位が付いているページがあればそれを対象にする
    if (!b.targetPage && row.ranking_page) b.targetPage = String(row.ranking_page);
  }

  const out = [...buckets.values()].map((b) => {
    // 期待値の大きい語から並べる。指示書の見出し設計もこの順で書いてもらう
    b.keywords.sort((x, y) => y.extraClicks - x.extraClicks || y.volume - x.volume);
    const positions = b.keywords.map((k) => k.position).filter((p): p is number => p != null);
    const bestPosition = positions.length ? Math.min(...positions) : null;
    b.actionType = decideActionType(b.isExistingPage, bestPosition);
    return b;
  });
  out.sort((a, b) => b.totalExtraClicks - a.totalExtraClicks);
  return out;
}

/** 承認画面と指示書で共通に使う「この記事で狙う語」の1行表記。 */
export function keywordLine(k: PlanKeywordGap): string {
  const pos = k.position == null ? "圏外" : `${k.position}位`;
  return `${k.query}（月${k.volume.toLocaleString("ja-JP")}検索 / 現在${pos} → 目標${k.targetPosition}位 / +${k.extraClicks}クリック）`;
}

/** 提案タイトル。「どの記事で何語取るのか」が一目で分かる形にする。 */
export function planProposalTitle(c: PlanCandidate, actionLabel: string): string {
  if (c.planId && c.keywords.length > 1) {
    return `記事「${c.planTitle}」で${c.keywords.length}語を取る（${actionLabel}）`;
  }
  return `狙う語「${c.mainKeyword}」を取る（${actionLabel}）`;
}
