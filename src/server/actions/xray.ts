"use server";

import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseXrayPayload, type XrayData } from "@/lib/xray";

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
  if (error) return null;
  return parseXrayPayload(data);
}
