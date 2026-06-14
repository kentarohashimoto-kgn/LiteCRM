/**
 * サブスク(継続課金)の売上予測。(推奨案 b軸+c補助)
 *   契約確定分 … billing_schedules(recurring) を月次展開（won=確定 / open=確度加重）
 *   更新見込み分 … 契約満了の翌月〜想定継続終了月(renewal_until_month)を
 *                  MRR × 更新確度(renewal_probability) で月次加重計上
 * 受注金額(amount)の一括計上と二重計上しないよう、ここは請求スケジュール基準で算出する。
 */
import type { OppView } from "@/lib/data/select";
import type { BillingSchedule } from "@/lib/types";
import type { FiscalMonth } from "@/lib/fiscal";

export interface SubMonth {
  key: string;
  label: string;
  confirmed: number; // 契約確定(受注済)の月次売上
  openWeighted: number; // 進行中(open)案件の月次 × 受注確度
  renewalWeighted: number; // 更新見込み × 更新確度
}

export interface SubOpp {
  id: string;
  account: string;
  name: string;
  status: string;
  mrr: number; // 月額(recurring合計)
  startMonth: string | null;
  endMonth: string | null;
  termMonths: number;
  contractedTcv: number; // 月額×契約月数
  renewalUntil: string | null;
  renewalProbability: number | null;
  renewalMonths: number; // 契約満了翌月〜想定継続終了月の月数
  renewalWeightedTcv: number; // 更新見込み(加重)合計
}

function ym(key: string): { y: number; m: number } {
  const [y, m] = key.split("-").map(Number);
  return { y, m };
}
function ymKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
function next(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}
/** [from, to] 月キー(YYYY-MM-01)を含む配列。to が null の場合は cap まで。 */
function monthRange(from: string, to: string | null, cap: string): string[] {
  const out: string[] = [];
  const end = to && to < cap ? to : cap;
  let { y, m } = ym(from);
  let key = ymKey(y, m);
  let guard = 0;
  while (key <= end && guard++ < 600) {
    out.push(key);
    ({ y, m } = next(y, m));
    key = ymKey(y, m);
  }
  return out;
}

export function buildSubscriptionForecast(
  opps: OppView[],
  billing: BillingSchedule[],
  months: FiscalMonth[],
): { monthly: SubMonth[]; subs: SubOpp[] } {
  const horizon = new Map<string, SubMonth>();
  for (const m of months) horizon.set(m.key, { key: m.key, label: m.label, confirmed: 0, openWeighted: 0, renewalWeighted: 0 });
  const cap = months.length ? months[months.length - 1].key : "";
  const oppById = new Map(opps.map((o) => [o.id, o]));

  // 案件ごとの recurring 請求をまとめる
  const recByOpp = new Map<string, BillingSchedule[]>();
  for (const b of billing) {
    if (b.kind !== "recurring" || !b.recurring_start_month) continue;
    const list = recByOpp.get(b.opportunity_id) ?? [];
    list.push(b);
    recByOpp.set(b.opportunity_id, list);
  }

  // 契約確定 / 進行中 の月次展開
  for (const [oppId, list] of recByOpp) {
    const o = oppById.get(oppId);
    if (!o || o.status === "lost") continue;
    for (const b of list) {
      const start = (b.recurring_start_month as string).slice(0, 7) + "-01";
      const end = b.recurring_end_month ? (b.recurring_end_month as string).slice(0, 7) + "-01" : null;
      for (const key of monthRange(start, end, cap)) {
        const slot = horizon.get(key);
        if (!slot) continue;
        if (o.status === "won") slot.confirmed += b.amount;
        else if (o.status === "open") slot.openWeighted += Math.round((b.amount * (o.probability ?? 0)) / 100);
      }
    }
  }

  // 更新見込み(契約満了の翌月〜想定継続終了月)
  const subs: SubOpp[] = [];
  const allSubOppIds = new Set<string>([
    ...recByOpp.keys(),
    ...opps.filter((o) => o.renewal_until_month).map((o) => o.id),
  ]);
  for (const oppId of allSubOppIds) {
    const o = oppById.get(oppId);
    if (!o) continue;
    const list = recByOpp.get(oppId) ?? [];
    const mrr = list.reduce((s, b) => s + b.amount, 0);
    const starts = list.map((b) => (b.recurring_start_month as string).slice(0, 7) + "-01").sort();
    const ends = list.filter((b) => b.recurring_end_month).map((b) => (b.recurring_end_month as string).slice(0, 7) + "-01").sort();
    const startMonth = starts[0] ?? null;
    const endMonth = ends.length ? ends[ends.length - 1] : null;
    const termMonths = startMonth && endMonth ? monthRange(startMonth, endMonth, endMonth).length : list.length ? 1 : 0;

    let renewalMonths = 0;
    let renewalWeightedTcv = 0;
    const renewalUntil = o.renewal_until_month ? (o.renewal_until_month as string).slice(0, 7) + "-01" : null;
    const rp = o.renewal_probability ?? null;
    if (renewalUntil && rp != null && mrr > 0 && endMonth) {
      const { y, m } = ym(endMonth);
      const nx = next(y, m);
      const rng = monthRange(ymKey(nx.y, nx.m), renewalUntil, renewalUntil);
      renewalMonths = rng.length;
      const perMonth = Math.round((mrr * rp) / 100);
      for (const key of rng) {
        renewalWeightedTcv += perMonth;
        const slot = horizon.get(key);
        if (slot) slot.renewalWeighted += perMonth;
      }
    }

    subs.push({
      id: o.id,
      account: o.account?.name ?? "—",
      name: o.name,
      status: o.status,
      mrr,
      startMonth,
      endMonth,
      termMonths,
      contractedTcv: mrr * (termMonths || 0),
      renewalUntil,
      renewalProbability: rp,
      renewalMonths,
      renewalWeightedTcv,
    });
  }

  subs.sort((a, b) => b.mrr - a.mrr);
  return { monthly: months.map((m) => horizon.get(m.key)!), subs };
}
