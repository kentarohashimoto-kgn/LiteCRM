/**
 * 目標(売上・成約・アポ・リード)に対する月別実績。
 *   売上/成約 … 受注済みを受注日(expected_close_date)で計上
 *   アポ      … 初回商談日(first_meeting_date)で計上
 *   リード    … leads.acquired_at で計上
 */
import type { OppView } from "@/lib/data/select";
import type { Lead } from "@/lib/types";
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

export function actualByMonth(opps: OppView[], leads: Lead[]): Map<string, MonthlyActual> {
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
  for (const l of leads) {
    if (l.acquired_at) ensure(monthKey(startOfMonth(new Date(l.acquired_at)))).leads += 1;
  }
  return map;
}
