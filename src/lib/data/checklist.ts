import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * B5 営業チェックシート(抜け漏れ可視化)。
 * 既存 opportunities の入力状況から「型の必須項目」が埋まっているかを判定する読み取り専用ボード。
 * 新規テーブル・書き込みは持たない(案件詳細の入力がそのまま source of truth)。RLSで担当範囲のみ。
 */

export type ChecklistItemDef = { key: string; label: string };

export const CHECKLIST_ITEMS: ChecklistItemDef[] = [
  { key: "issue", label: "課題ヒアリング" },
  { key: "solution", label: "提案内容" },
  { key: "next", label: "次回アクション" },
  { key: "dm", label: "決裁者確認" },
  { key: "budget", label: "予算確認" },
  { key: "proposal", label: "提案/見積" },
];

export type ChecklistOpp = {
  id: string;
  name: string;
  account: string | null;
  yomi: string | null;
  amount: number;
  done: Record<string, boolean>;
  doneCount: number;
  total: number;
};

export type ChecklistBoard = {
  opps: ChecklistOpp[];
  avgRate: number; // 平均充足率
  gapCount: number; // 抜けのある案件数
};

type Row = {
  id: string;
  name: string | null;
  yomi: string | null;
  amount: number | null;
  customer_issue: string | null;
  proposed_solution: string | null;
  next_action_date: string | null;
  decision_maker_status: string | null;
  budget_status: string | null;
  proposal_required: boolean | null;
  proposal_status: string | null;
  accounts: { name: string | null } | null;
};

/** 「記録済み」判定: 値があり、未確認系でない。 */
function recorded(v: string | null): boolean {
  const s = (v ?? "").trim();
  if (!s) return false;
  return !["未確認", "未", "未定", "unknown", "none", "なし"].includes(s);
}

export async function getChecklistBoard(gapOnly: boolean): Promise<ChecklistBoard> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("opportunities")
    .select(
      "id,name,yomi,amount,customer_issue,proposed_solution,next_action_date,decision_maker_status,budget_status,proposal_required,proposal_status,accounts(name)",
    )
    .eq("status", "open")
    .is("deleted_at", null)
    .limit(2000);

  const rows = (data ?? []) as unknown as Row[];
  const opps: ChecklistOpp[] = rows.map((o) => {
    const done: Record<string, boolean> = {
      issue: !!o.customer_issue?.trim(),
      solution: !!o.proposed_solution?.trim(),
      next: !!o.next_action_date,
      dm: recorded(o.decision_maker_status),
      budget: recorded(o.budget_status),
      proposal: o.proposal_required ? recorded(o.proposal_status) : true,
    };
    const doneCount = CHECKLIST_ITEMS.filter((i) => done[i.key]).length;
    return {
      id: o.id,
      name: o.name ?? "—",
      account: o.accounts?.name ?? null,
      yomi: o.yomi,
      amount: o.amount ?? 0,
      done,
      doneCount,
      total: CHECKLIST_ITEMS.length,
    };
  });

  const gaps = opps.filter((o) => o.doneCount < o.total);
  const avgRate = opps.length ? opps.reduce((s, o) => s + o.doneCount / o.total, 0) / opps.length : 0;

  const shown = (gapOnly ? gaps : opps).sort((a, b) => a.doneCount - b.doneCount || b.amount - a.amount);

  return { opps: shown, avgRate, gapCount: gaps.length };
}
