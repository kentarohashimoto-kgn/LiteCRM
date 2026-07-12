/**
 * リード画面の集計(企業ビュー・分析)の型定義とJS参照実装。
 * 【重要】集計の本番経路は SQL集計RPC(migration 0125: leads_companies/leads_funnel/
 * leads_analysis)に移行済み(2026-07-12・パリティ検証済み)。build* 関数は仕様の
 * 参照実装として残している。RPC側を変更する場合はここと意味を一致させること。
 * 一覧/架電キューは SQL 側でページング・件数制限して取得する(lib/data/leads.ts)。
 */
import type { Lead } from "@/lib/types";
import { LEAD_DISPOSITIONS } from "@/lib/constants";

/** 集計に必要な最小列のみ。 */
export type AggLead = Pick<
  Lead,
  "id" | "company_name" | "company_norm" | "contact_name" | "rank" | "job_title" | "employee_size" | "raw_event" | "priority_score" | "disposition" | "acquirer" | "scanned_at" | "funnel_stage"
>;

export interface WsListRow {
  id: string; company: string; name: string; rank: string; jobTitle: string; empSizeBucket: string;
  event: string; score: number; disposition: string; callOwner: string; phone: string; mobilePhone: string; converted: boolean;
  engRank: string; engScore: number; funnelStage: string;
}
export interface FunnelStageData { key: string; count: number; rows: { id: string; company: string; name: string; rank: string; score: number }[] }
export interface FunnelData { stages: Record<string, FunnelStageData>; total: number }
export interface WsQueueRow {
  id: string; score: number; company: string; name: string; rank: string; jobTitle: string;
  event: string; disposition: string; phone: string; mobilePhone: string; callOwner: string;
}
export interface WsCompanyRow {
  norm: string; name: string; contacts: number; events: string[]; maxScore: number; best: string; multi: boolean;
}
export interface WsAttr { k: string; total: number; appt: number; rate: number }
export interface WsAnalysisScope {
  total: number; called: number; appt: number; ng: number; noans: number; highUntouched: number;
  acqPerf: WsAttr[]; hourDist: number[]; dispCounts: { key: string; label: string; n: number }[];
  byRank: WsAttr[]; byRole: WsAttr[]; bySize: WsAttr[];
  multiCount: number; multiAppt: number; singleCount: number; singleAppt: number;
}
export interface CompaniesData { rows: WsCompanyRow[]; total: number; multi: number }
export interface AnalysisData { events: string[]; scopes: Record<string, WsAnalysisScope>; rawAcquirers: string[] }

export interface LeadsFilters { q?: string; event?: string; disposition?: string; rank?: string; page?: number }

export function roleBucket(t: string): string {
  if (/社長|代表|CEO|会長/.test(t)) return "経営者";
  if (/役員|取締役/.test(t)) return "役員";
  if (/本部長|部長|次長|部門長/.test(t)) return "部長";
  if (/課長/.test(t)) return "課長";
  return "担当";
}
export function sizeBucket(s: string): string {
  const nums = (s.match(/[\d,]+/g) || []).map((x) => parseInt(x.replace(/,/g, ""), 10));
  const m = nums.length ? Math.max(...nums) : 0;
  return m >= 1000 ? "1000名+" : m >= 300 ? "300-999名" : m >= 100 ? "100-299名" : m ? "〜99名" : "不明";
}

const DISP_ORDER = ["appointment", "continuing", "calling", "no_answer", "untouched", "ng", "excluded"];

export function buildCompanies(leads: AggLead[]): CompaniesData {
  const score = (l: AggLead) => l.priority_score ?? 0;
  const cm = new Map<string, { norm: string; name: string; contacts: number; events: Set<string>; maxScore: number; best: string }>();
  for (const l of leads) {
    const k = l.company_norm || l.company_name || "";
    if (!k) continue;
    let c = cm.get(k);
    if (!c) { c = { norm: k, name: l.company_name ?? "", contacts: 0, events: new Set<string>(), maxScore: 0, best: l.disposition ?? "untouched" }; cm.set(k, c); }
    c.contacts++;
    if (l.raw_event) c.events.add(l.raw_event);
    c.maxScore = Math.max(c.maxScore, score(l));
    const d = l.disposition ?? "untouched";
    if (DISP_ORDER.indexOf(d) < DISP_ORDER.indexOf(c.best)) c.best = d;
  }
  const all = [...cm.values()].sort((a, b) => b.events.size - a.events.size || b.maxScore - a.maxScore);
  const rows = all.slice(0, 400).map((c) => ({
    norm: c.norm, name: c.name, contacts: c.contacts, events: [...c.events], maxScore: c.maxScore, best: c.best, multi: c.events.size >= 2,
  }));
  return { rows, total: all.length, multi: all.filter((c) => c.events.size >= 2).length };
}

function attrAgg(leads: AggLead[], key: (l: AggLead) => string): WsAttr[] {
  const m = new Map<string, { total: number; appt: number }>();
  for (const l of leads) {
    const k = key(l) || "—";
    const v = m.get(k) ?? { total: 0, appt: 0 };
    v.total++; if (l.disposition === "appointment") v.appt++;
    m.set(k, v);
  }
  return [...m.entries()].map(([k, v]) => ({ k, ...v, rate: v.total ? v.appt / v.total : 0 })).sort((a, b) => b.total - a.total);
}

function buildScope(leads: AggLead[], aliasMap: Map<string, string>): WsAnalysisScope {
  const total = leads.length;
  const called = leads.filter((l) => l.disposition && l.disposition !== "untouched").length;
  const appt = leads.filter((l) => l.disposition === "appointment").length;
  const ng = leads.filter((l) => l.disposition === "ng").length;
  const noans = leads.filter((l) => l.disposition === "no_answer").length;
  const highUntouched = leads.filter((l) => (l.priority_score ?? 0) >= 70 && (l.disposition ?? "untouched") === "untouched").length;

  const acqPerf = attrAgg(leads, (l) => { const raw = l.acquirer ?? ""; return raw ? aliasMap.get(raw) || raw : "(不明)"; });

  const hourDist = Array.from({ length: 24 }, () => 0);
  for (const l of leads) {
    const m = (l.scanned_at ?? "").match(/T(\d{2}):/);
    if (m) hourDist[parseInt(m[1], 10)]++;
  }
  const dispCounts = LEAD_DISPOSITIONS.map((d) => ({ key: d.key, label: d.label, n: leads.filter((l) => (l.disposition ?? "untouched") === d.key).length }));

  const compMap = new Map<string, { events: Set<string>; appt: boolean }>();
  for (const l of leads) {
    const k = l.company_norm || l.company_name || "";
    if (!k) continue;
    const c = compMap.get(k) ?? { events: new Set<string>(), appt: false };
    if (l.raw_event) c.events.add(l.raw_event);
    if (l.disposition === "appointment") c.appt = true;
    compMap.set(k, c);
  }
  const comps = [...compMap.values()];
  const multi = comps.filter((c) => c.events.size >= 2);
  const single = comps.filter((c) => c.events.size <= 1);

  return {
    total, called, appt, ng, noans, highUntouched, acqPerf, hourDist, dispCounts,
    byRank: attrAgg(leads, (l) => l.rank ?? ""),
    byRole: attrAgg(leads, (l) => roleBucket(l.job_title ?? "")),
    bySize: attrAgg(leads, (l) => sizeBucket(l.employee_size ?? "")),
    multiCount: multi.length, multiAppt: multi.filter((c) => c.appt).length,
    singleCount: single.length, singleAppt: single.filter((c) => c.appt).length,
  };
}

export function buildAnalysis(leads: AggLead[], aliases: { raw: string; name: string }[]): AnalysisData {
  const aliasMap = new Map(aliases.map((a) => [a.raw, a.name]));
  const events = [...new Set(leads.map((l) => l.raw_event ?? "").filter(Boolean))];
  const scopes: Record<string, WsAnalysisScope> = { "": buildScope(leads, aliasMap) };
  for (const e of events) scopes[e] = buildScope(leads.filter((l) => l.raw_event === e), aliasMap);
  const rawAcquirers = [...new Set(leads.map((l) => l.acquirer ?? "").filter(Boolean))].sort();
  return { events, scopes, rawAcquirers };
}

/** アポ前ファネル: ステージ別件数＋各ステージ上位リード(優先度順)。 */
export function buildFunnel(leads: AggLead[]): FunnelData {
  const stages: Record<string, FunnelStageData> = {};
  for (const l of leads) {
    const k = (l.funnel_stage as string) || "new";
    if (!stages[k]) stages[k] = { key: k, count: 0, rows: [] };
    stages[k].count++;
    stages[k].rows.push({ id: l.id, company: l.company_name ?? "", name: l.contact_name ?? "", rank: l.rank ?? "", score: l.priority_score ?? 0 });
  }
  for (const k of Object.keys(stages)) {
    stages[k].rows.sort((a, b) => b.score - a.score);
    stages[k].rows = stages[k].rows.slice(0, 50);
  }
  return { stages, total: leads.length };
}
