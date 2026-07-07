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
  fu_due: number;           // 研修後FU: 期間内に期日を迎えた面談
  fu_held: number;
  fu_proposals: number;
  fu_upsell: number;
}

export interface XrayTargets { amount: number; leads: number; appointments: number; deals: number; months: number; }
export interface XrayMonthly { ym: string; leads: number; appts: number; won: number; revenue: number; }
export interface XrayDim { name: string; leads?: number; appts?: number; meets?: number; won?: number; revenue?: number; }

export interface XrayData {
  cur: XrayPeriod;
  cmp: XrayPeriod;
  targets: XrayTargets | null;
  monthly: XrayMonthly[];
  exhibitions: XrayDim[];
  reps: XrayDim[];
  products: XrayDim[];
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
