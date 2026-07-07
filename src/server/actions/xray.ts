"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { XrayData, XrayPeriod } from "@/lib/xray";

const EMPTY: XrayPeriod = {
  leads: 0, appts: 0, meets: 0, won: 0, revenue: 0,
  st_resched: 0, st_cancel: 0, st_pending: 0, st_appt: 0,
  won_booked: 0, revenue_booked: 0, revenue_exist: 0,
  fu_due: 0, fu_held: 0, fu_proposals: 0, fu_upsell: 0,
};

function coerce(p: Partial<XrayPeriod> | null | undefined): XrayPeriod {
  const out = { ...EMPTY };
  if (!p) return out;
  for (const k of Object.keys(EMPTY) as (keyof XrayPeriod)[]) {
    out[k] = Number(p[k] ?? 0);
  }
  return out;
}

/** 営業レントゲンのメトリクス取得。期間・比較期間はユーザーが自由に指定(end排他的)。 */
export async function fetchXrayAction(input: {
  start: string;
  end: string;
  cmpStart: string;
  cmpEnd: string;
}): Promise<XrayData | null> {
  await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb.rpc("xray_metrics", {
    p_start: input.start,
    p_end: input.end,
    p_cmp_start: input.cmpStart,
    p_cmp_end: input.cmpEnd,
  });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  const targets = d.targets as XrayData["targets"];
  return {
    cur: coerce(d.cur as Partial<XrayPeriod>),
    cmp: coerce(d.cmp as Partial<XrayPeriod>),
    targets: targets && Number(targets.months) > 0
      ? { amount: Number(targets.amount), leads: Number(targets.leads), appointments: Number(targets.appointments), deals: Number(targets.deals), months: Number(targets.months) }
      : null,
    monthly: (d.monthly as XrayData["monthly"]) ?? [],
    exhibitions: (d.exhibitions as XrayData["exhibitions"]) ?? [],
    reps: (d.reps as XrayData["reps"]) ?? [],
    products: (d.products as XrayData["products"]) ?? [],
  };
}
