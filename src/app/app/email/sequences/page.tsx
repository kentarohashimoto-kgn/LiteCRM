import Link from "next/link";
import { PenSquare, Square } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { SequenceBuilder } from "@/components/email/sequence-builder";
import { EnrollPanel } from "@/components/email/enroll-panel";
import { stopEnrollmentAction } from "@/server/actions/sequences";
import type { EmailTemplate } from "@/app/app/email/templates/page";

export const dynamic = "force-dynamic";

export interface SequenceRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  steps: { wait_days: number; template_id: string }[];
  stop_on: { on_won?: boolean; on_lost?: boolean; on_appointment?: boolean };
}
interface EnrollRow {
  id: string;
  sequence_id: string;
  to_addr: string;
  status: string;
  current_step: number;
  next_due_date: string | null;
  stopped_reason: string | null;
}

const ENROLL_STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "進行中", cls: "bg-emerald-100 text-emerald-700" },
  completed: { label: "完了", cls: "bg-ink/[0.06] text-ink/55" },
  stopped: { label: "停止", cls: "bg-rose-100 text-rose-700" },
};

/**
 * WO-21 メールシーケンス(追客カデンス)管理(F-101b)。
 * 多段フォローを定義→案件/担当者を投入→日次cronが本人アカウント経由で自動送信。
 */
export default async function SequencesPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [seqR, tplR, enrR] = await Promise.all([
    sb.from("email_sequences").select("id, name, description, status, steps, stop_on").order("created_at"),
    sb.from("email_templates").select("id, name, category, subject_tmpl, body_tmpl").order("category").order("name"),
    sb.from("sequence_enrollments").select("id, sequence_id, to_addr, status, current_step, next_due_date, stopped_reason").order("created_at", { ascending: false }).limit(50),
  ]);
  if (seqR.error) throw new Error(`シーケンス取得に失敗: ${seqR.error.message}`);
  const sequences = (seqR.data ?? []) as SequenceRow[];
  const templates = (tplR.data ?? []) as EmailTemplate[];
  const enrollments = (enrR.data ?? []) as EnrollRow[];
  const seqName = new Map(sequences.map((s) => [s.id, s.name]));
  const canEdit = !["viewer", "delivery", "finance", "back_office", "hr"].includes(ctx.role);
  const activeSequences = sequences.filter((s) => s.status === "active");

  return (
    <div>
      <PageHeader
        title="メールシーケンス（追客）"
        subtitle="「Day0お礼 → Day3資料 → Day7再打診」のような多段フォローを定義。案件を投入すると、あなたのメールアカウント経由で日次自動送信され、受注/失注/アポ化で自動停止します。"
      />
      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{ created: "シーケンスを作成しました。", updated: "更新しました。", stopped: "投入を停止しました。" }}
        errorMessages={{
          forbidden: "編集権限がありません。",
          invalid: "名称を入力してください。",
          need_steps: "ステップを1件以上（テンプレートを選択して）追加してください。",
          save_failed: "保存に失敗しました。",
        }}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/app/email/templates" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <PenSquare size={14} /> 定型文を管理
        </Link>
        <Link href="/app/email/history" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">送信履歴</Link>
      </div>

      <Section title="シーケンス定義" className="mb-6">
        <SequenceBuilder sequences={sequences} templates={templates} canEdit={canEdit} />
      </Section>

      {canEdit && activeSequences.length > 0 && (
        <Section title="案件/担当者を投入" className="mb-6">
          <EnrollPanel sequences={activeSequences.map((s) => ({ id: s.id, name: s.name }))} />
        </Section>
      )}

      <Section title="投入状況（直近50件）">
        {enrollments.length === 0 ? (
          <EmptyState message="まだ投入がありません。上で案件/担当者を投入すると、翌朝以降のcronで自動送信が始まります。" />
        ) : (
          <div className="space-y-2">
            {enrollments.map((e) => {
              const st = ENROLL_STATUS[e.status] ?? ENROLL_STATUS.active;
              const seq = sequences.find((s) => s.id === e.sequence_id);
              const total = seq?.steps.length ?? 0;
              return (
                <div key={e.id} className="rounded-xl border border-black/[0.06] p-3 flex items-center gap-3 flex-wrap">
                  <span className={`pill text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                  <span className="font-medium text-sm text-ink/90">{seqName.get(e.sequence_id) ?? "—"}</span>
                  <span className="text-xs text-ink/50">→ {e.to_addr}</span>
                  <span className="text-xs text-ink/50">ステップ {Math.min(e.current_step + (e.status === "active" ? 1 : 0), total)}/{total}</span>
                  {e.status === "active" && e.next_due_date && <span className="text-xs text-ink/40">次回 {e.next_due_date}</span>}
                  {e.stopped_reason && <span className="text-xs text-rose-500">{e.stopped_reason}</span>}
                  {canEdit && e.status === "active" && (
                    <form action={stopEnrollmentAction} className="ml-auto">
                      <input type="hidden" name="id" value={e.id} />
                      <SubmitButton className="btn-ghost inline-flex items-center gap-1 text-xs text-rose-600" pendingLabel="停止中…">
                        <Square size={11} /> 停止
                      </SubmitButton>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <p className="text-xs text-ink/40 mt-4">
        送信には「メール送信アカウント接続」（各営業のSMTP）が必要です。停止条件（受注/失注/アポ化）は案件のヨミ変化で自動判定します。
        返信での自動停止は受信同期（将来のF-101a常時同期）が前提のため現時点では未対応です。
      </p>
    </div>
  );
}
