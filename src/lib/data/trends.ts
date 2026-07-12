/**
 * トレンド分析のデータ集計(既存DB参照のみ)。
 * リード(属性が豊富)を主体に、企業→商談(受注/ヨミ/金額)の状態で対象範囲を絞り込み、
 * エリア/業種/規模/部署/ABC/コホート/流入 を集計する。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { normCompany } from "@/lib/lead-import";
import { regionOf, empBucket, industryLabel, deptLabel, abcClassify, type AbcRow } from "@/lib/trends";
import { monthKey, startOfMonth } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */
// 件数→全ページ並列取得(逐次round-tripを排除)。
async function selectAll(sb: any, table: string, columns: string): Promise<any[]> {
  const PAGE = 1000;
  const { count, error: countErr } = await sb.from(table).select("id", { count: "exact", head: true });
  if (countErr) throw new Error(`${table} の件数取得に失敗しました: ${countErr.message}`);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const reqs = [];
  for (let p = 0; p < pages; p++) reqs.push(sb.from(table).select(columns).order("id").range(p * PAGE, (p + 1) * PAGE - 1));
  const res = await Promise.all(reqs);
  for (const r of res) if (r?.error) throw new Error(`${table} の取得に失敗しました: ${r.error.message}`);
  return res.flatMap((r: any) => r?.data ?? []);
}

interface CompanyDeal { won: boolean; a: boolean; b: boolean; open: boolean; wonAmount: number; pipeline: number; name: string }
export interface GroupRow { key: string; label: string; count: number; companies: number; wonAmount: number; share: number }
export interface TrendsData {
  scope: string; totalLeads: number; totalCompanies: number;
  region: GroupRow[]; prefecture: GroupRow[]; industry: GroupRow[]; empsize: GroupRow[]; department: GroupRow[]; source: GroupRow[];
  abc: AbcRow[]; abcSummary: Record<"A" | "B" | "C", { count: number; value: number }>;
  cohort: { month: string; leads: number; converted: number; won: number }[];
}

export async function buildTrends(scope: string): Promise<TrendsData> {
  const sb = getSupabaseServer();
  const [leads, opps, accounts, sources] = await Promise.all([
    selectAll(sb, "leads", "company_norm,company_name,prefecture,industry,employee_size,department,acquired_at,lead_source_id,account_id,status"),
    selectAll(sb, "opportunities", "account_id,status,yomi,amount"),
    selectAll(sb, "accounts", "id,name"),
    sb.from("lead_sources").select("id,name").then((r: any) => r.data ?? []),
  ]);
  const accName = new Map<string, string>(accounts.map((a: any) => [a.id, a.name]));
  const sourceName = new Map<string, string>((sources as any[]).map((s) => [s.id, s.name]));

  // 企業(正規化名)ごとの商談状態
  const deal = new Map<string, CompanyDeal>();
  for (const o of opps) {
    const nm = accName.get(o.account_id) ?? "";
    const cn = normCompany(nm);
    if (!cn) continue;
    let d = deal.get(cn);
    if (!d) { d = { won: false, a: false, b: false, open: false, wonAmount: 0, pipeline: 0, name: nm }; deal.set(cn, d); }
    if (o.status === "won") { d.won = true; d.wonAmount += o.amount ?? 0; }
    if (o.status === "open") { d.open = true; d.pipeline += o.amount ?? 0; if (o.yomi?.startsWith("1.A")) d.a = true; if (o.yomi?.startsWith("2.B")) d.b = true; }
  }
  const inScope = (cn: string, accountId: string | null) => {
    const d = cn ? deal.get(cn) : undefined;
    switch (scope) {
      case "converted": return !!accountId;
      case "won": return !!d?.won;
      case "a": return !!d?.a;
      case "b": return !!d?.b;
      case "open": return !!d?.open;
      default: return true;
    }
  };

  const filtered = leads.filter((l: any) => inScope(l.company_norm || "", l.account_id ?? null));

  // 汎用グルーピング(リード数・企業数・受注額)
  function group(keyOf: (l: any) => { key: string; label: string }): GroupRow[] {
    const m = new Map<string, { label: string; count: number; comp: Set<string> }>();
    for (const l of filtered) {
      const { key, label } = keyOf(l);
      let g = m.get(key); if (!g) { g = { label, count: 0, comp: new Set() }; m.set(key, g); }
      g.count++; if (l.company_norm) g.comp.add(l.company_norm);
    }
    const total = filtered.length || 1;
    return [...m.entries()].map(([key, g]) => {
      let wonAmount = 0; for (const cn of g.comp) wonAmount += deal.get(cn)?.wonAmount ?? 0;
      return { key, label: g.label, count: g.count, companies: g.comp.size, wonAmount, share: g.count / total };
    }).sort((a, b) => b.count - a.count);
  }

  const region = group((l) => { const r = regionOf(l.prefecture); return { key: r, label: r }; });
  const prefecture = group((l) => { const p = (l.prefecture ?? "").trim() || "不明"; return { key: p, label: p }; });
  const industry = group((l) => { const i = industryLabel(l.industry); return { key: i, label: i }; });
  const empsize = group((l) => { const e = empBucket(l.employee_size); return { key: e, label: e }; });
  const department = group((l) => { const d = deptLabel(l.department); return { key: d, label: d }; }).slice(0, 30);
  const source = group((l) => { const id = l.lead_source_id; const nm = id ? sourceName.get(id) ?? "その他" : "直接/不明"; return { key: nm, label: nm }; });

  // ABC分析(対象範囲の企業を金額で分類)。金額=受注額(+パイプライン)。
  const compInScope = new Set<string>(filtered.map((l: any) => l.company_norm).filter(Boolean));
  const abcItems = [...compInScope].map((cn) => { const d = deal.get(cn); return { key: cn, label: d?.name || cn, value: (d?.wonAmount ?? 0) + (d?.pipeline ?? 0) }; });
  const abc = abcClassify(abcItems);
  const abcSummary = { A: { count: 0, value: 0 }, B: { count: 0, value: 0 }, C: { count: 0, value: 0 } };
  for (const r of abc) { abcSummary[r.rank].count++; abcSummary[r.rank].value += r.value; }

  // コホート分析(獲得月別の リード→案件化→受注)
  const cohortMap = new Map<string, { leads: number; converted: number; won: number }>();
  for (const l of filtered) {
    if (!l.acquired_at) continue;
    const k = monthKey(startOfMonth(new Date(l.acquired_at)));
    let c = cohortMap.get(k); if (!c) { c = { leads: 0, converted: 0, won: 0 }; cohortMap.set(k, c); }
    c.leads++;
    if (l.account_id) c.converted++;
    if (l.company_norm && deal.get(l.company_norm)?.won) c.won++;
  }
  const cohort = [...cohortMap.entries()].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));

  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    scope, totalLeads: filtered.length, totalCompanies: compInScope.size,
    region, prefecture, industry, empsize, department, source,
    abc: abc.slice(0, 50), abcSummary, cohort,
  };
}
