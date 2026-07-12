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

const TOTAL = CHECKLIST_ITEMS.length;

type RpcOpp = {
  id: string;
  name: string | null;
  account: string | null;
  yomi: string | null;
  amount: number | null;
  done: Record<string, boolean>;
  doneCount: number;
};
type RpcPayload = { total?: number; gapCount?: number; avgRate?: number; opps?: RpcOpp[] };

/**
 * 集計RPC `checklist_metrics` に移行(監査2026-07-12)。6項目の充足判定はSQL側で実施し
 * 判定済みの軽量行だけを返す(全opp列のJS転送を回避・データ増耐性)。並びはRPCで
 * done_count昇順・amount降順(旧JSと同一)。gapOnly絞り込みのみJS側(軽量)。
 */
export async function getChecklistBoard(gapOnly: boolean): Promise<ChecklistBoard> {
  const sb = getSupabaseServer();
  const { data } = await sb.rpc("checklist_metrics");
  const p = (data ?? {}) as RpcPayload;

  const opps: ChecklistOpp[] = (p.opps ?? []).map((o) => ({
    id: o.id,
    name: o.name ?? "—",
    account: o.account ?? null,
    yomi: o.yomi,
    amount: Number(o.amount ?? 0),
    done: o.done ?? {},
    doneCount: Number(o.doneCount ?? 0),
    total: TOTAL,
  }));

  const shown = gapOnly ? opps.filter((o) => o.doneCount < o.total) : opps;
  return { opps: shown, avgRate: Number(p.avgRate ?? 0), gapCount: Number(p.gapCount ?? 0) };
}
