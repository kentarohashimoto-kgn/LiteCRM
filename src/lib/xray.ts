/**
 * 営業レントゲン診断 — 純粋ロジック。
 * 売上の方程式(リード数×アポ獲得率×商談実施率×受注率×平均単価)を因数分解し、
 * 各因数の健康度と「基準値に戻した場合の売上増(機会損失額)」を計算する。
 * DBアクセスなし・全て純関数(vitestで回帰テスト)。
 */

export interface XrayPeriod {
  leads: number;
  appts: number;
  meets: number;
  won: number;
  revenue: number;          // コホート売上(この期間に獲得した案件からの受注額)
  st_resched: number;       // 5.リスケ
  st_cancel: number;        // 8.キャンセル
  st_pending: number;       // 9.調整中
  st_appt: number;          // 4.アポ(実施待ち)
  won_booked: number;       // 計上ベース受注件数(期間内に受注)
  revenue_booked: number;   // 計上ベース売上
  revenue_exist: number;    // うち既存顧客(2回目以降の受注)
  revenue_stock: number;    // うちストック型(顧問/月額/保守等のサブスク的商材 or recurring請求)
  fu_due: number;           // 研修後FU: 期間内に期日を迎えた面談
  fu_held: number;
  fu_proposals: number;
  fu_upsell: number;
}

/** 期間に依存しない構造指標(既存顧客エンジン・サブスクの現在地)。 */
export interface XrayBase {
  won_accounts: number;       // 受注済み顧客数(母数)
  repeat_accounts: number;    // 2回以上受注した顧客数
  avg_won_price: number;      // 全期間の平均受注単価
  fu_cases_total: number;     // 研修後FU対象(既存エンジンの母数)
  fu_meets_total: number;     // FU面談の総数(1/3/6ヶ月)
  fu_held_total: number;
  fu_prop_total: number;
  fu_upsell_total: number;
  revenue_all: number;        // 全期間の受注売上
  revenue_stock_all: number;  // うちストック型
  mrr: number;                // recurring請求の月額合計
  recurring_contracts: number;
}

export interface XrayTargets { amount: number; leads: number; appointments: number; deals: number; months: number; }
export interface XrayMonthly { ym: string; leads: number; appts: number; won: number; revenue: number; }
export interface XrayDim { name: string; leads?: number; appts?: number; meets?: number; won?: number; revenue?: number; }

export interface XrayData {
  cur: XrayPeriod;
  cmp: XrayPeriod;
  base: XrayBase;
  targets: XrayTargets | null;
  monthly: XrayMonthly[];
  exhibitions: XrayDim[];
  reps: XrayDim[];
  products: XrayDim[];
}

/** RPC(xray_metrics)のjsonbレスポンスを型安全なXrayDataへ変換(数値化・欠損補完)。 */
export function parseXrayPayload(data: unknown): XrayData | null {
  const d = data as Record<string, unknown> | null;
  if (!d || !d.cur) return null;
  const emptyPeriod: XrayPeriod = {
    leads: 0, appts: 0, meets: 0, won: 0, revenue: 0,
    st_resched: 0, st_cancel: 0, st_pending: 0, st_appt: 0,
    won_booked: 0, revenue_booked: 0, revenue_exist: 0, revenue_stock: 0,
    fu_due: 0, fu_held: 0, fu_proposals: 0, fu_upsell: 0,
  };
  const emptyBase: XrayBase = {
    won_accounts: 0, repeat_accounts: 0, avg_won_price: 0,
    fu_cases_total: 0, fu_meets_total: 0, fu_held_total: 0, fu_prop_total: 0, fu_upsell_total: 0,
    revenue_all: 0, revenue_stock_all: 0, mrr: 0, recurring_contracts: 0,
  };
  function nums<T extends object>(template: T, src: unknown): T {
    const out: Record<string, number> = {};
    const s = (src ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(template)) out[k] = Number(s[k] ?? 0);
    return out as T;
  }
  const targets = d.targets as XrayTargets | null;
  return {
    cur: nums(emptyPeriod, d.cur),
    cmp: nums(emptyPeriod, d.cmp),
    base: nums(emptyBase, d.base),
    targets: targets && Number(targets.months) > 0
      ? { amount: Number(targets.amount), leads: Number(targets.leads), appointments: Number(targets.appointments), deals: Number(targets.deals), months: Number(targets.months) }
      : null,
    monthly: (d.monthly as XrayMonthly[]) ?? [],
    exhibitions: (d.exhibitions as XrayDim[]) ?? [],
    reps: (d.reps as XrayDim[]) ?? [],
    products: (d.products as XrayDim[]) ?? [],
  };
}

export type Health = "good" | "warn" | "bad" | "na";
export type NodeKey = "leads" | "apptRate" | "meetRate" | "winRate" | "avgPrice";

/** 診断の分母がこの件数未満のノードは「判定保留」(データ不足で誤診しない)。 */
export const MIN_DENOM = 5;

export function safeRate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export interface ChainRates {
  apptRate: number | null;  // アポ数/リード数
  meetRate: number | null;  // 商談実施/アポ数
  winRate: number | null;   // 受注/商談実施
  avgPrice: number | null;  // コホート売上/受注件数
}

export function chainRates(p: XrayPeriod): ChainRates {
  return {
    apptRate: safeRate(p.appts, p.leads),
    meetRate: safeRate(p.meets, p.appts),
    winRate: safeRate(p.won, p.meets),
    avgPrice: p.won > 0 ? p.revenue / p.won : null,
  };
}

/** 健康度: 基準比-10%までgood / -25%までwarn / それ超はbad。基準なし・分母不足はna。 */
export function rateHealth(cur: number | null, base: number | null, denom: number): Health {
  if (cur == null || base == null || base <= 0 || denom < MIN_DENOM) return "na";
  const change = (cur - base) / base;
  if (change >= -0.1) return "good";
  if (change >= -0.25) return "warn";
  return "bad";
}

export interface NodeDiag {
  key: NodeKey;
  label: string;
  cur: number | null;
  base: number | null;
  changePct: number | null; // (cur-base)/base
  health: Health;
  impact: number;           // このノードだけ基準値に戻した場合の売上増(円)。改善余地がなければ0
  denom: number;            // 判定に使った分母(データ量)
}

const NODE_LABELS: Record<NodeKey, string> = {
  leads: "リード数",
  apptRate: "アポ獲得率",
  meetRate: "商談実施率",
  winRate: "受注率",
  avgPrice: "平均受注単価",
};

/** チェーン売上 = リード × アポ率 × 実施率 × 受注率 × 単価。null因数があればnull。 */
function chainRevenue(leads: number, r: ChainRates): number | null {
  if (r.apptRate == null || r.meetRate == null || r.winRate == null || r.avgPrice == null) return null;
  return leads * r.apptRate * r.meetRate * r.winRate * r.avgPrice;
}

/**
 * 5ノードの診断。impactは「そのノードだけ比較期間の値に戻した時の売上増分」。
 * cur側の因数がnull(分母0)のノードはimpact計算から除外(0)。
 */
export function diagnose(cur: XrayPeriod, cmp: XrayPeriod): NodeDiag[] {
  const rc = chainRates(cur);
  const rb = chainRates(cmp);
  const curRev = chainRevenue(cur.leads, rc);

  function impactOf(key: NodeKey): number {
    if (curRev == null) return 0;
    const restored: ChainRates = { ...rc };
    let leads = cur.leads;
    if (key === "leads") {
      if (cmp.leads <= cur.leads) return 0;
      leads = cmp.leads;
    } else {
      const base = rb[key];
      const curV = rc[key];
      if (base == null || curV == null || base <= curV) return 0;
      restored[key] = base;
    }
    const rev = chainRevenue(leads, restored);
    return rev == null ? 0 : Math.max(0, Math.round(rev - curRev));
  }

  const denoms: Record<NodeKey, number> = {
    leads: cmp.leads,          // 基準側の存在量
    apptRate: cur.leads,
    meetRate: cur.appts,
    winRate: cur.meets,
    avgPrice: cur.won,
  };

  const vals: Record<NodeKey, { cur: number | null; base: number | null }> = {
    leads: { cur: cur.leads, base: cmp.leads > 0 ? cmp.leads : null },
    apptRate: { cur: rc.apptRate, base: rb.apptRate },
    meetRate: { cur: rc.meetRate, base: rb.meetRate },
    winRate: { cur: rc.winRate, base: rb.winRate },
    avgPrice: { cur: rc.avgPrice, base: rb.avgPrice },
  };

  return (Object.keys(NODE_LABELS) as NodeKey[]).map((key) => {
    const { cur: c, base: b } = vals[key];
    const changePct = c != null && b != null && b > 0 ? (c - b) / b : null;
    return {
      key,
      label: NODE_LABELS[key],
      cur: c,
      base: b,
      changePct,
      health: rateHealth(c, b, denoms[key]),
      impact: impactOf(key),
      denom: denoms[key],
    };
  });
}

export interface Prescription {
  key: string;
  severity: "bad" | "warn" | "info";
  title: string;
  body: string;
  impact: number; // 円(0=金額換算なし)
}

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function yen(v: number): string {
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

/** 診断結果から「今月の処方箋」(重要度=機会損失額順、最大3件)を生成。 */
export function prescriptions(nodes: NodeDiag[], cur: XrayPeriod): Prescription[] {
  const out: Prescription[] = [];

  const bodies: Record<NodeKey, (n: NodeDiag) => string> = {
    leads: (n) =>
      `リード獲得が ${n.base ?? "—"}件 → ${n.cur ?? "—"}件 に減少。展示会・チャネルの出稿計画を確認してください。`,
    apptRate: (n) =>
      `アポ獲得率が ${pct(n.base)} → ${pct(n.cur)} に低下。獲得済みリードの掘り起こし(架電・メルマガ)を強化してください。`,
    meetRate: (n) =>
      `商談実施率が ${pct(n.base)} → ${pct(n.cur)} に低下。リスケ${cur.st_resched}件・調整中${cur.st_pending}件が滞留しています。日程の再設定を最優先に。`,
    winRate: (n) =>
      `受注率が ${pct(n.base)} → ${pct(n.cur)} に低下。提案内容・価格・失注理由のレビューを推奨します。`,
    avgPrice: (n) =>
      `平均受注単価が ${n.base != null ? yen(n.base) : "—"} → ${n.cur != null ? yen(n.cur) : "—"} に低下。商材ミックス(高単価商材の提案比率)を確認してください。`,
  };

  const declining = nodes
    .filter((n) => (n.health === "bad" || n.health === "warn") && n.impact > 0)
    .sort((a, b) => b.impact - a.impact);

  for (const n of declining.slice(0, 3)) {
    out.push({
      key: n.key,
      severity: n.health === "bad" ? "bad" : "warn",
      title: `${n.label}の悪化 — 改善で売上 +${yen(n.impact)} 相当`,
      body: bodies[n.key](n),
      impact: n.impact,
    });
  }

  // ルールベースの追加処方(期間比較に依存しない構造的な問題)
  if (out.length < 3 && cur.fu_due >= 3) {
    const heldRate = cur.fu_held / cur.fu_due;
    if (heldRate < 0.5) {
      out.push({
        key: "fu",
        severity: heldRate === 0 ? "bad" : "warn",
        title: `研修後フォロー面談が未消化 (${cur.fu_held}/${cur.fu_due}件)`,
        body: "期日を迎えたフォローアップ面談が実施されていません。既存顧客のアップセル機会を逃しています。研修後フォロー画面から日程調整を。",
        impact: 0,
      });
    }
  }
  if (out.length < 3 && cur.appts >= MIN_DENOM) {
    const stalled = cur.st_resched + cur.st_pending;
    if (stalled / cur.appts >= 0.15) {
      out.push({
        key: "stalled",
        severity: "warn",
        title: `商談の滞留が ${stalled}件 (アポの${Math.round((stalled / cur.appts) * 100)}%)`,
        body: `リスケ${cur.st_resched}件・調整中${cur.st_pending}件。放置すると失注化します。今週中の再アプローチ対象としてタスク化を推奨します。`,
        impact: 0,
      });
    }
  }

  return out.slice(0, 3);
}

/* ============================================================
 * 既存顧客エンジン(リピート・横展開)の「あるべき数式」
 * データが無くても型と参考値を提示し、ポテンシャルとのギャップを見せる。
 * ============================================================ */

/**
 * 参考値(一般的なBtoB研修・コンサル事業の目安)。
 * 実測が貯まったら自社実績に置き換える前提の初期ベンチマーク。
 */
export const EXIST_REF = {
  fuHeldRate: 0.8,     // FU面談実施率: 期日を迎えた面談の8割は実施できるはず
  proposalRate: 0.4,   // 面談→追加提案率: 4割で次の課題・提案が生まれる
  closeRate: 0.25,     // 提案→成約率: 既存顧客は信頼があるため新規より高い
  upsellPriceRatio: 0.6, // アップセル単価は初回受注単価の6割程度から
  cyclesPerYear: 3,    // 1顧客あたり年間のFU接点(1・3・6ヶ月)
} as const;

export interface ExistStep {
  key: string;
  label: string;
  cur: number | null;   // 現在の率(計測不能ならnull)
  ref: number;          // 参考値
  measurable: boolean;  // 分母が存在するか
}

export interface ExistEngine {
  steps: ExistStep[];
  baseCount: number;          // 母数(FU対象顧客)
  actualUpsells: number;      // 実績アップセル数(全期間)
  potentialDealsYear: number; // 参考値達成時の年間アップセル件数
  potentialRevenueYear: number; // 同・年間売上
}

/** 既存顧客エンジンの現在地とポテンシャル。母数×参考値で「本来あるべき数字」を算出。 */
export function existingEngine(base: XrayBase): ExistEngine {
  const heldRate = safeRate(base.fu_held_total, base.fu_meets_total);
  const propRate = safeRate(base.fu_prop_total, base.fu_held_total);
  const closeRate = safeRate(base.fu_upsell_total, base.fu_prop_total);
  const price = base.avg_won_price * EXIST_REF.upsellPriceRatio;
  const potentialDealsYear =
    base.fu_cases_total * EXIST_REF.cyclesPerYear * EXIST_REF.fuHeldRate * EXIST_REF.proposalRate * EXIST_REF.closeRate;
  return {
    steps: [
      { key: "held", label: "FU面談 実施率", cur: heldRate, ref: EXIST_REF.fuHeldRate, measurable: base.fu_meets_total > 0 },
      { key: "propose", label: "面談 → 追加提案率", cur: propRate, ref: EXIST_REF.proposalRate, measurable: base.fu_held_total > 0 },
      { key: "close", label: "提案 → 成約率", cur: closeRate, ref: EXIST_REF.closeRate, measurable: base.fu_prop_total > 0 },
    ],
    baseCount: base.fu_cases_total,
    actualUpsells: base.fu_upsell_total,
    potentialDealsYear,
    potentialRevenueYear: Math.round(potentialDealsYear * price),
  };
}

/* ============================================================
 * サブスク・ストック売上比率の診断
 * ============================================================ */

/** ストック売上比率の目標帯(サービス業の安定経営の目安: 30〜50%)。 */
export const STOCK_TARGET = { min: 0.3, max: 0.5 } as const;

export interface StockDiag {
  share: number | null;        // 期間のストック比率
  shareAll: number | null;     // 全期間のストック比率
  targetMin: number;
  targetMax: number;
  gapYenToMin: number;         // 目標下限に届くのに必要なストック売上の不足額(期間)
  mrr: number;
  mrrTargetMonthly: number;    // 全期間売上の月割×目標下限 = 目指すべき月額ストック
  recurringContracts: number;
  advices: { title: string; body: string }[];
}

/**
 * ストック比率の診断とアドバイス生成。
 * 月間の売上規模(revenueBookedMonthly)から「目標帯に入るためのMRR」を逆算する。
 */
export function stockDiagnosis(cur: XrayPeriod, base: XrayBase, periodMonths: number): StockDiag {
  const share = cur.revenue_booked > 0 ? cur.revenue_stock / cur.revenue_booked : null;
  const shareAll = base.revenue_all > 0 ? base.revenue_stock_all / base.revenue_all : null;
  const gapYenToMin = Math.max(0, Math.round(cur.revenue_booked * STOCK_TARGET.min - cur.revenue_stock));
  const monthlyRevenue = periodMonths > 0 ? cur.revenue_booked / periodMonths : 0;
  const mrrTargetMonthly = Math.round(monthlyRevenue * STOCK_TARGET.min);

  const advices: { title: string; body: string }[] = [];
  const shareNow = shareAll ?? share ?? 0;
  if (shareNow < STOCK_TARGET.min) {
    advices.push({
      title: "研修に月額サポートを標準添付する",
      body: `研修受注時に「AI活用伴走サポート(月額)」をオプション提案。研修${base.fu_cases_total}社×添付率20%×月額15万円ならMRR+¥${(base.fu_cases_total * 0.2 * 150000).toLocaleString("ja-JP")}。研修効果の定着支援なので顧客価値とも一致します。`,
    });
    advices.push({
      title: "AI顧問を複数年・自動更新契約に",
      body: "単発の顧問契約を12ヶ月自動更新に切り替え、更新率を管理する。既に顧問実績があるため、契約形態の変更だけでストック化できます。",
    });
  }
  if (base.recurring_contracts <= 3) {
    advices.push({
      title: "継続契約を請求スケジュールに登録して計測可能に",
      body: `recurring登録は現在${base.recurring_contracts}件のみ。顧問・保守など実態が継続課金の案件を案件詳細の請求スケジュールに登録すると、MRR・解約率・更新率が計測できるようになります(計測できないものは改善できません)。`,
    });
  }
  return {
    share, shareAll,
    targetMin: STOCK_TARGET.min, targetMax: STOCK_TARGET.max,
    gapYenToMin,
    mrr: base.mrr,
    mrrTargetMonthly,
    recurringContracts: base.recurring_contracts,
    advices: advices.slice(0, 3),
  };
}
