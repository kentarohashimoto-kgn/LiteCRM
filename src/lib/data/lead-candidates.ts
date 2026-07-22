import type { getSupabaseServer } from "@/lib/supabase/server";
import { normCompany } from "@/lib/lead-import";

type SB = ReturnType<typeof getSupabaseServer>;

/** アカウンター候補として引くリードの必要列。 */
export type LeadCandRow = {
  id: string;
  contact_name?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  department?: string | null;
  job_title?: string | null;
  role_level?: string | null;
  raw_event?: string | null;
};

/** 画面に渡す候補（AccounterPanel / AccountContactsPanel の LeadCandidate と同形）。 */
export interface LeadCandidateView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  source: string | null;
}

/** 役職の高い順に並べるためのランク（小さいほど上位）。job_title のキーワードで判定。 */
export function leadRoleRank(jobTitle?: string | null, roleLevel?: string | null): number {
  const t = `${jobTitle ?? ""} ${roleLevel ?? ""}`;
  if (/社長|代表|会長|オーナー|CEO|ＣＥＯ/.test(t)) return 0;
  if (/取締役|役員|執行役員|本部長|事業部長|CxO|C[TFOI]O|ＣＴＯ|ＣＦＯ/.test(t)) return 1;
  if (/部長|部門長|センター長|室長|支店長|所長/.test(t)) return 2;
  if (/課長|次長|マネージャ|マネジャー|グループ長|チームリーダー/.test(t)) return 3;
  if (/係長|主任|リーダー|チーフ|主査/.test(t)) return 4;
  if (jobTitle && jobTitle.trim()) return 5;
  return 6;
}

/**
 * 同じ会社（account_id か 正規化会社名一致）で、まだ担当者化していないリードを引くクエリ。
 * PostgREST の or() を壊さない値のみ会社名一致に使う（括弧・カンマ等は account_id のみ）。
 */
export function leadCandidatesQuery(sb: SB, accountId: string, accountName: string) {
  const norm = normCompany(accountName);
  const safeNorm = norm && !/[(),.]/.test(norm) ? norm : "";
  return sb
    .from("leads")
    .select("id, contact_name, last_name, first_name, email, phone, mobile_phone, department, job_title, role_level, raw_event, acquired_at, contact_id")
    .is("contact_id", null)
    .is("deleted_at", null)
    .neq("status", "disqualified")
    .or(safeNorm ? `account_id.eq.${accountId},company_norm.eq.${safeNorm}` : `account_id.eq.${accountId}`)
    .order("acquired_at", { ascending: false })
    .limit(60);
}

/**
 * 候補リード行を画面用に整形する。
 *  - 既存担当者(メール一致)や候補内のメール重複は除外
 *  - 役職の高い順に並べる
 */
export function buildLeadCandidates(rows: LeadCandRow[], excludeEmails: Set<string>): LeadCandidateView[] {
  const seen = new Set<string>();
  return rows
    .map((l) => ({
      id: l.id,
      name: (l.contact_name || [l.last_name, l.first_name].filter(Boolean).join(" ") || l.email || "（名称未設定）").trim(),
      email: l.email ?? null,
      phone: l.phone || l.mobile_phone || null,
      jobTitle: l.job_title ?? null,
      department: l.department ?? null,
      source: l.raw_event ?? null,
      rank: leadRoleRank(l.job_title, l.role_level),
    }))
    .filter((c) => {
      const e = (c.email ?? "").toLowerCase();
      if (e && excludeEmails.has(e)) return false;
      if (e) { if (seen.has(e)) return false; seen.add(e); }
      return true;
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ja"))
    .map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, jobTitle: c.jobTitle, department: c.department, source: c.source }));
}
