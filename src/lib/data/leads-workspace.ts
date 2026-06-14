/**
 * リード画面の集計をサーバー側で実施し、クライアントへは「境界のある結果」だけ渡す。
 * 全リード(数千〜万件)はサーバーメモリ上でのみ扱い、クライアントには送らない。
 */
import type { Lead } from "@/lib/types";
import { LEAD_DISPOSITIONS } from "@/lib/constants";

export interface WsListRow {
  id: string;
  company: string;
  name: string;
  rank: string;
  jobTitle: string;
  empSizeBucket: string;
  event: string;
  score: number;
  disposition: string;
  callOwner: string;
  phone: string;
  mobilePhone: string;
  converted: boolean;
}
export interface WsQueueRow {
  id: string;
  score: number;
  company: string;
  name: string;
  rank: string;
  jobTitle: string;
  event: string;
  disposition: string;
  phone: string;
  mobilePhone: string;
  callOwner: string;
}
export interface WsCompanyRow {
  norm: string;
  name: string;
  contacts: number;
  events: string[];
  maxScore: number;
  best: string;
  multi: boolean;
}
export interface WsAttr { k: string; total: number; appt: number; rate: number }
export interface WsAnalysisScope {
  total: number; called: number; appt: number; ng: number; noans: number; highUntouched: number;
  acqPerf: WsAttr[];
  hourDist: number[];
  dispCounts: { key: string; label: string; n: number }[];
  byRank: WsAttr[]; byRole: WsAttr[]; bySize: WsAttr[];
  multiCount: number; multiAppt: number; singleCount: number; singleAppt: number;
}
export interface LeadsWorkspaceData {
  totalLeads: number;
  list: { rows: WsListRow[]; total: number; page: number; pageSize: number };
  queue: { rows: WsQueueRow[]; total: number };
  companies: { rows: WsCompanyRow[]; total: number; multi: number };
  analysis: { events: string[]; scopes: Record<string, WsAnalysisScope>; rawAcquirers: string[] };
}

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

const PAGE_SIZE = 100;
const DISP_ORDER = ["appointment", "continuing", "calling", "no_answer", "untouched", "ng", "excluded"];

function attrAgg(leads: Lead[], key: (l: Lead) => string): WsAttr[] {
  const m = new Map<string, { total: number; appt: number }>();
  for (const l of leads) {
    const k = key(l) || "—";
    const v = m.get(k) ?? { total: 0, appt: 0 };
    v.total++; if (l.disposition === "appointment") v.appt++;
    m.set(k, v);
  }
  return [...m.entries()].map(([k, v]) => ({ k, ...v, rate: v.total ? v.appt / v.total : 0 })).sort((a, b) => b.total - a.total);
}

function buildScope(leads: Lead[], aliasMap: Map<string, string>): WsAnalysisScope {
  const total = leads.length;
  const called = leads.filter((l) => l.disposition && l.disposition !== "untouched").length;
  const appt = leads.filter((l) => l.disposition === "appointment").length;
  const ng = leads.filter((l) => l.disposition === "ng").length;
  const noans = leads.filter((l) => l.disposition === "no_answer").length;
  const highUntouched = leads.filter((l) => (l.priority_score ?? 0) >= 70 && (l.disposition ?? "untouched") === "untouched").length;

  const acqPerf = attrAgg(leads, (l) => {
    const raw = l.acquirer ?? "";
    return raw ? aliasMap.get(raw) || raw : "(不明)";
  });

  const hourDist = Array.from({ length: 24 }, () => 0);
  for (const l of leads) {
    const m = (l.scanned_at ?? "").match(/T(\d{2}):/);
    if (m) hourDist[parseInt(m[1], 10)]++;
  }

  const dispCounts = LEAD_DISPOSITIONS.map((d) => ({ key: d.key, label: d.label, n: leads.filter((l) => (l.disposition ?? "untouched") === d.key).length }));

  // 企業単位の複数接点アポ率
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
    total, called, appt, ng, noans, highUntouched,
    acqPerf, hourDist, dispCounts,
    byRank: attrAgg(leads, (l) => l.rank ?? ""),
    byRole: attrAgg(leads, (l) => roleBucket(l.job_title ?? "")),
    bySize: attrAgg(leads, (l) => sizeBucket(l.employee_size ?? "")),
    multiCount: multi.length, multiAppt: multi.filter((c) => c.appt).length,
    singleCount: single.length, singleAppt: single.filter((c) => c.appt).length,
  };
}

export function buildLeadsWorkspace(leads: Lead[], aliases: { raw: string; name: string }[], filters: LeadsFilters): LeadsWorkspaceData {
  const aliasMap = new Map(aliases.map((a) => [a.raw, a.name]));
  const score = (l: Lead) => l.priority_score ?? 0;

  // ---- リスト(フィルタ＋優先度降順＋ページング) ----
  const q = (filters.q ?? "").toLowerCase().trim();
  const fEvent = filters.event ?? "";
  const fDisp = filters.disposition ?? "";
  const fRank = filters.rank ?? "";
  const listFiltered = leads.filter((l) => {
    if (q && !`${l.company_name ?? ""} ${l.contact_name ?? ""}`.toLowerCase().includes(q)) return false;
    if (fEvent && l.raw_event !== fEvent) return false;
    if (fDisp && (l.disposition ?? "untouched") !== fDisp) return false;
    if (fRank && (l.rank ?? "") !== fRank) return false;
    return true;
  });
  listFiltered.sort((a, b) => score(b) - score(a));
  const page = Math.max(1, filters.page ?? 1);
  const start = (page - 1) * PAGE_SIZE;
  const listRows: WsListRow[] = listFiltered.slice(start, start + PAGE_SIZE).map((l) => ({
    id: l.id,
    company: l.company_name ?? "",
    name: l.contact_name ?? "",
    rank: l.rank ?? "",
    jobTitle: l.job_title ?? "",
    empSizeBucket: sizeBucket(l.employee_size ?? ""),
    event: l.raw_event ?? "",
    score: score(l),
    disposition: l.disposition ?? "untouched",
    callOwner: l.call_owner ?? "",
    phone: l.phone ?? "",
    mobilePhone: l.mobile_phone ?? "",
    converted: !!l.account_id || l.status === "converted",
  }));

  // ---- 架電キュー(未着手・不通 / 上位300) ----
  const queueAll = leads.filter((l) => (l.disposition ?? "untouched") === "untouched" || l.disposition === "no_answer").sort((a, b) => score(b) - score(a));
  const queueRows: WsQueueRow[] = queueAll.slice(0, 300).map((l) => ({
    id: l.id, score: score(l), company: l.company_name ?? "", name: l.contact_name ?? "",
    rank: l.rank ?? "", jobTitle: l.job_title ?? "", event: l.raw_event ?? "",
    disposition: l.disposition ?? "untouched", phone: l.phone ?? "", mobilePhone: l.mobile_phone ?? "", callOwner: l.call_owner ?? "",
  }));

  // ---- 企業ビュー(名寄せ集計 / 上位400) ----
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
  const compsAll = [...cm.values()].sort((a, b) => b.events.size - a.events.size || b.maxScore - a.maxScore);
  const companyRows: WsCompanyRow[] = compsAll.slice(0, 400).map((c) => ({
    norm: c.norm, name: c.name, contacts: c.contacts, events: [...c.events], maxScore: c.maxScore, best: c.best, multi: c.events.size >= 2,
  }));
  const multiCount = compsAll.filter((c) => c.events.size >= 2).length;

  // ---- 分析(全体 + イベント別) ----
  const events = [...new Set(leads.map((l) => l.raw_event ?? "").filter(Boolean))];
  const scopes: Record<string, WsAnalysisScope> = { "": buildScope(leads, aliasMap) };
  for (const e of events) scopes[e] = buildScope(leads.filter((l) => l.raw_event === e), aliasMap);
  const rawAcquirers = [...new Set(leads.map((l) => l.acquirer ?? "").filter(Boolean))].sort();

  return {
    totalLeads: leads.length,
    list: { rows: listRows, total: listFiltered.length, page, pageSize: PAGE_SIZE },
    queue: { rows: queueRows, total: queueAll.length },
    companies: { rows: companyRows, total: compsAll.length, multi: multiCount },
    analysis: { events, scopes, rawAcquirers },
  };
}
