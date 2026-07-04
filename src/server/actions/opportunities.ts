"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { yomiToFields } from "@/lib/deal-import";
import { casUpdate } from "./_helpers";
import { ensureTransitionOnWon } from "@/server/transitions-util";

export type OppInlineField =
  | "yomi"
  | "amount"
  | "expected_revenue_month"
  | "next_action_date"
  | "next_action_text"
  | "owner_user_id";

export type OppInlineResult =
  | { ok: true; updated_at: string; patch: Record<string, unknown> }
  | { ok: false; error: string; conflict?: boolean };

/** ヨミの先頭数字（大分類）。0..9 / 不明はNaN。 */
function yomiMajor(y: string | null | undefined): number {
  if (!y) return NaN;
  const n = parseInt(y[0], 10);
  return Number.isNaN(n) ? NaN : n;
}

interface OppFinancials {
  amount: number | null;
  expected_close_date: string | null;
}

/**
 * ヨミを A以上(2.B/1.A/0.受注)へ「引き上げる」ときの財務ハードストップ検証。
 * 要件書4.3の A以上=提案金額・受注予定日 必須 に対応。
 * ※ 顧客課題・提案書などの検証は案件詳細フォーム(全項目編集可)側で行う。
 *   インライン/ボードのクイック編集では、これらは編集不可のためブロックしない。
 */
function validateYomiRaise(targetYomi: string, cur: OppFinancials): string | null {
  const major = yomiMajor(targetYomi);
  const isAplus = major === 2 || major === 1 || major === 0;
  if (!isAplus) return null;
  const missing: string[] = [];
  if (!(cur.amount && cur.amount > 0)) missing.push("提案金額");
  if (!cur.expected_close_date) missing.push("受注予定日");
  if (missing.length) {
    return `ヨミを「${targetYomi}」へ上げるには次の入力が必要です: ${missing.join(" / ")}（案件詳細で入力してください）`;
  }
  return null;
}

/**
 * 案件一覧/ボードのインライン編集。1フィールドをCAS(楽観ロック)で更新。
 * ヨミ変更時は stage/status/forecast/probability を取込ロジックと同じ規則で連動更新する。
 */
export async function updateOppInlineAction(input: {
  id: string;
  updatedAt: string;
  field: OppInlineField;
  value: string | null;
}): Promise<OppInlineResult> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const patch: Record<string, unknown> = {};

  if (input.field === "yomi") {
    const y = (input.value ?? "").trim();
    if (y) {
      const { data: cur } = await sb
        .from("opportunities")
        .select("amount,expected_close_date")
        .eq("id", input.id)
        .maybeSingle();
      const err = validateYomiRaise(y, {
        amount: (cur?.amount as number) ?? null,
        expected_close_date: (cur?.expected_close_date as string) ?? null,
      });
      if (err) return { ok: false, error: err };
    }
    const f = yomiToFields(y);
    patch.yomi = y || null;
    patch.stage = f.stage;
    patch.status = f.status;
    patch.forecast_category = f.forecast;
    patch.probability = f.probability;
  } else if (input.field === "amount") {
    const v = input.value == null || input.value === "" ? 0 : Number(String(input.value).replace(/[^\d.-]/g, ""));
    patch.amount = Number.isNaN(v) ? 0 : v;
  } else if (input.field === "expected_revenue_month") {
    patch.expected_revenue_month = input.value ? input.value.slice(0, 7) + "-01" : null;
  } else if (input.field === "next_action_date") {
    patch.next_action_date = input.value || null;
  } else if (input.field === "next_action_text") {
    patch.next_action_text = input.value || null;
  } else if (input.field === "owner_user_id") {
    patch.owner_user_id = input.value || null;
  } else {
    return { ok: false, error: "不正なフィールドです" };
  }

  const res = await casUpdate("opportunities", input.id, input.updatedAt, patch);
  if (!res.ok) return res;

  // 研修/開発案件が受注になったらトランジションを自動作成
  if (patch.status === "won") {
    await ensureTransitionOnWon(ctx.tenantId, ctx.userId, input.id);
  }

  revalidatePath("/app/opportunities");
  revalidatePath("/app/forecast");
  return { ok: true, updated_at: res.updated_at, patch };
}
