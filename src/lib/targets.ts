/**
 * 目標(売上・成約・アポ・リード)に対する月別実績。
 *   売上/成約 … 受注済みを受注日(expected_close_date)で計上
 *   アポ      … 初回商談日(first_meeting_date)で計上
 *   リード    … leads.acquired_at で計上
 */
import type { OppView } from "@/lib/data/select";
import { monthKey, startOfMonth } from "@/lib/utils";

export interface MonthlyActual {
  revenue: number;
  deals: number;
  appts: number;
  leads: number;
}

export function emptyActual(): MonthlyActual {
  return { revenue: 0, deals: 0, appts: 0, leads: 0 };
}

/**
 * 月別実績。リードは件数が大きいため行ではなく「月別件数マップ」を受け取る。
 *   leadsByMonth: acquired_at 月(YYYY-MM-01) -> 件数
 */
export function actualByMonth(opps: OppView[], leadsByMonth: Map<string, number>): Map<string, MonthlyActual> {
  const map = new Map<string, MonthlyActual>();
  const ensure = (k: string) => {
    let v = map.get(k);
    if (!v) {
      v = emptyActual();
      map.set(k, v);
    }
    return v;
  };
  for (const o of opps) {
    if (o.status === "won" && o.amount) {
      const ref = o.expected_close_date || o.expected_revenue_month;
      if (ref) {
        const v = ensure(monthKey(startOfMonth(new Date(ref))));
        v.revenue += o.amount;
        v.deals += 1;
      }
    }
    if (o.first_meeting_date) {
      ensure(monthKey(startOfMonth(new Date(o.first_meeting_date)))).appts += 1;
    }
  }
  for (const [k, n] of leadsByMonth) ensure(k).leads += n;
  return map;
}
