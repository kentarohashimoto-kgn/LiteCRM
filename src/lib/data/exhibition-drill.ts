import { cache } from "react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";

/** 展示会ドリルダウン: 案件(商談)一覧・未商談の重要リード・コメント。 */
export interface DrillOpp {
  id: string;
  name: string;
  account_name: string | null;
  owner_name: string | null;
  stage: string;
  yomi: string | null;
  amount: number;
  probability: number;
  status: string;
  next_action_date: string | null;
  next_action_text: string | null;
  last_activity_at: string | null;
  comment_count: number;
}

export interface DrillLead {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  job_title: string | null;
  department: string | null;
  rank: string | null;
  funnel_stage: string | null;
  disposition: string | null;
  nurture_status: string | null;
  owner_name: string | null;
  notes: string | null;
  priority_score: number;
  comment_count: number;
}

export interface CommentVM {
  id: string;
  author_user_id: string;
  authorName: string;
  body: string;
  created_at: string;
}

export interface ExhibitionDrill {
  campaign: { id: string; name: string; event_date: string | null; organizer: string | null; cost: number | null } | null;
  opps: DrillOpp[];
  leads: DrillLead[];
  totalUntouched: number;
  oppComments: Record<string, CommentVM[]>;
  leadComments: Record<string, CommentVM[]>;
  members: { id: string; name: string }[];
}

const LEAD_LIMIT = 80;

export const getExhibitionDrill = cache(async (campaignId: string): Promise<ExhibitionDrill> => {
  await requireCtx();
  const sb = getSupabaseServer();

  const [campR, oppR, leadR, profR] = await Promise.all([
    sb.from("campaigns").select("id,name,event_date,organizer,cost").eq("id", campaignId).maybeSingle(),
    sb.rpc("exhibition_opps", { p_campaign: campaignId }),
    sb.rpc("exhibition_untouched_leads", { p_campaign: campaignId, p_limit: LEAD_LIMIT }),
    sb.from("profiles").select("id,display_name,email"),
  ]);

  const opps = (oppR.data ?? []) as DrillOpp[];
  const leadsRaw = (leadR.data ?? []) as (DrillLead & { total_untouched: number })[];
  const leads: DrillLead[] = leadsRaw.map(({ total_untouched: _t, ...l }) => l);
  const totalUntouched = Number(leadsRaw[0]?.total_untouched ?? 0);

  const profiles = (profR.data ?? []) as { id: string; display_name: string | null; email: string | null }[];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name ?? p.email ?? "—"]));
  const members = profiles.map((p) => ({ id: p.id, name: p.display_name ?? p.email ?? "—" }));

  const oppIds = opps.map((o) => o.id);
  const leadIds = leads.map((l) => l.id);

  const [ocR, lcR] = await Promise.all([
    oppIds.length
      ? sb.from("opportunity_comments").select("id,opportunity_id,author_user_id,body,created_at").in("opportunity_id", oppIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    leadIds.length
      ? sb.from("lead_comments").select("id,lead_id,author_user_id,body,created_at").in("lead_id", leadIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const oppComments: Record<string, CommentVM[]> = {};
  for (const c of (ocR.data ?? []) as { id: string; opportunity_id: string; author_user_id: string; body: string; created_at: string }[]) {
    (oppComments[c.opportunity_id] ??= []).push({
      id: c.id, author_user_id: c.author_user_id, authorName: nameById.get(c.author_user_id) ?? "—", body: c.body, created_at: c.created_at,
    });
  }
  const leadComments: Record<string, CommentVM[]> = {};
  for (const c of (lcR.data ?? []) as { id: string; lead_id: string; author_user_id: string; body: string; created_at: string }[]) {
    (leadComments[c.lead_id] ??= []).push({
      id: c.id, author_user_id: c.author_user_id, authorName: nameById.get(c.author_user_id) ?? "—", body: c.body, created_at: c.created_at,
    });
  }

  return {
    campaign: (campR.data as ExhibitionDrill["campaign"]) ?? null,
    opps,
    leads,
    totalUntouched,
    oppComments,
    leadComments,
    members,
  };
});
