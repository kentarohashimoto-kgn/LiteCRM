import { Play, Square } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { getBatchDashboard } from "@/lib/data/batch-runs";
import { BatchDashboardView } from "@/components/exec/batch-dashboard";
import { toggleBatchJobAction } from "@/server/actions/batch-jobs";

export const dynamic = "force-dynamic";

interface JobSetting {
  id: string;
  job_kind: string;
  label: string;
  description: string | null;
  enabled: boolean;
  note: string | null;
  updated_at: string;
}

/**
 * AIバッチ運用ダッシュボード。
 * ジョブごとのスタート/停止制御(batch_job_settings)と、
 * 夜間バッチ(方針A / Claude Code方式・従量課金ゼロ)の運用ログ可視化。
 */
export default async function BatchOpsPage(props: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [data, jobsR] = await Promise.all([
    getBatchDashboard(),
    sb.from("batch_job_settings").select("id, job_kind, label, description, enabled, note, updated_at").order("created_at"),
  ]);
  if (jobsR.error) throw new Error(`バッチ設定の取得に失敗: ${jobsR.error.message}`);
  const jobs = (jobsR.data ?? []) as JobSetting[];
  const canControl = ["owner", "admin"].includes(ctx.role);

  return (
    <div>
      <PageHeader
        title="AIバッチ運用"
        subtitle="ジョブごとのスタート/停止と、夜間バッチ(03:00 JST・Claudeサブスク枠)の実績。停止中のジョブは夜間セッション・APIの両方で実行されません。"
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          started: "ジョブを開始しました。次回の夜間バッチから実行されます。",
          stopped: "ジョブを停止しました。夜間セッション・APIの両方で実行されなくなります。",
        }}
        errorMessages={{
          forbidden: "バッチ制御の権限がありません（owner/adminのみ）。",
          invalid: "入力内容が不正です。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      <Section title="ジョブ制御" className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {jobs.map((j) => (
            <div key={j.id} className={`rounded-xl border p-4 ${j.enabled ? "border-emerald-200 bg-emerald-50/30" : "border-black/[0.06] bg-mist-soft/20"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-semibold text-sm text-ink/90">{j.label}</span>
                <span className={`pill text-[10px] font-bold ${j.enabled ? "bg-emerald-100 text-emerald-700" : "bg-ink/10 text-ink/55"}`}>
                  {j.enabled ? "稼働中" : "停止中"}
                </span>
              </div>
              {j.description && <p className="text-xs text-ink/55 mb-1.5">{j.description}</p>}
              {j.note && <p className="text-xs text-amber-700 mb-1.5">メモ: {j.note}</p>}
              {canControl ? (
                <form action={toggleBatchJobAction} className="mt-2 flex items-center gap-2">
                  <input type="hidden" name="id" value={j.id} />
                  <input type="hidden" name="to" value={j.enabled ? "stop" : "start"} />
                  <input name="note" defaultValue={j.note ?? ""} placeholder="メモ（停止理由など）" className="input text-xs py-1.5 flex-1" />
                  {j.enabled ? (
                    <SubmitButton className="btn-ghost inline-flex items-center gap-1 text-xs text-rose-600 whitespace-nowrap" pendingLabel="停止中…">
                      <Square size={12} /> 停止する
                    </SubmitButton>
                  ) : (
                    <SubmitButton className="btn-accent inline-flex items-center gap-1 text-xs whitespace-nowrap" pendingLabel="開始中…">
                      <Play size={12} /> 開始する
                    </SubmitButton>
                  )}
                </form>
              ) : (
                <p className="text-[11px] text-ink/40 mt-2">切替は owner/admin のみ</p>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-ink/40 mt-3">
          停止中のジョブは、夜間のClaude Codeセッション（実行前にこの設定を確認）とバッチAPI（取得0件・書き戻し409）の両方でブロックされます。
        </p>
      </Section>

      <BatchDashboardView data={data} />
    </div>
  );
}
