import { Play, Square, Trash2, Plus, Zap } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { AUTOMATION_RECIPES, IMPLEMENTED_TRIGGERS } from "@/lib/automation";
import { createRuleFromRecipeAction, toggleRuleAction, deleteRuleAction } from "@/server/actions/automation";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Rule {
  id: string;
  name: string;
  recipe_key: string | null;
  trigger_type: string;
  enabled: boolean;
  updated_at: string;
}
interface Run {
  id: string;
  rule_id: string;
  fired_at: string;
  status: string;
  target_id: string | null;
}

const TRIGGER_LABEL: Record<string, string> = {
  yomi_changed: "ヨミ変更",
  stage_changed: "ステージ変更",
  next_action_overdue: "次回AC超過",
  no_activity_days: "N日無活動",
  amount_threshold: "金額しきい値",
  lead_created: "新規リード",
  task_assigned: "タスク割当",
};

/**
 * WO-18 ワークフロー自動化(F-102) 設定画面。
 * レシピを選んでルールを作成→有効化。発火は /api/cron/automation(バッチ)。
 * 「WHEN(業務イベント)→IF(条件)→THEN(Slack/通知/タスク)」の軽量Flow。
 */
export default async function AutomationPage(props: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [rulesR, runsR] = await Promise.all([
    sb.from("automation_rules").select("id, name, recipe_key, trigger_type, enabled, updated_at").order("created_at"),
    sb.from("automation_runs").select("id, rule_id, fired_at, status, target_id").order("fired_at", { ascending: false }).limit(20),
  ]);
  if (rulesR.error) throw new Error(`ルールの取得に失敗: ${rulesR.error.message}`);
  const rules = (rulesR.data ?? []) as Rule[];
  const runs = (runsR.data ?? []) as Run[];
  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
  const canControl = ["owner", "admin"].includes(ctx.role);
  const usedRecipeKeys = new Set(rules.map((r) => r.recipe_key).filter(Boolean) as string[]);
  const availableRecipes = AUTOMATION_RECIPES.filter((r) => !usedRecipeKeys.has(r.key));

  return (
    <div>
      <PageHeader
        title="ワークフロー自動化"
        subtitle="「ヨミC転落→Slack」のような軽量ルールを定義。有効なルールを短間隔バッチが評価し、Slack・アプリ内通知・タスク起票を自動実行します。"
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          created: "ルールを作成しました（停止状態）。内容を確認して「開始する」で有効化してください。",
          started: "ルールを有効化しました。次回のバッチ評価から発火します。",
          stopped: "ルールを停止しました。発火しなくなります。",
          deleted: "ルールを削除しました。",
        }}
        errorMessages={{
          forbidden: "自動化ルールの設定は owner/admin のみ可能です。",
          invalid: "入力内容が不正です。",
          duplicate: "同じレシピのルールが既に存在します。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      {/* 稼働中/停止中のルール一覧 */}
      <Section title="ルール一覧" className="mb-6">
        {rules.length === 0 ? (
          <EmptyState message="まだルールがありません。下の「レシピから追加」で作成できます。" />
        ) : (
          <div className="space-y-2">
            {rules.map((r) => {
              const implemented = IMPLEMENTED_TRIGGERS.has(r.trigger_type);
              return (
                <div key={r.id} className={`rounded-xl border p-4 ${r.enabled ? "border-emerald-200 bg-emerald-50/30" : "border-black/[0.06] bg-mist-soft/20"}`}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Zap size={14} className="text-accent" />
                    <span className="font-semibold text-sm text-ink/90">{r.name}</span>
                    <span className={`pill text-[10px] font-bold ${r.enabled ? "bg-emerald-100 text-emerald-700" : "bg-ink/10 text-ink/55"}`}>
                      {r.enabled ? "稼働中" : "停止中"}
                    </span>
                    <span className="pill text-[10px] bg-ink/[0.06] text-ink/55">{TRIGGER_LABEL[r.trigger_type] ?? r.trigger_type}</span>
                    {!implemented && (
                      <span className="pill text-[10px] bg-amber-100 text-amber-700">このトリガーは発火未対応（WO-19で対応予定）</span>
                    )}
                  </div>
                  {canControl && (
                    <div className="mt-2 flex items-center gap-2">
                      <form action={toggleRuleAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="to" value={r.enabled ? "stop" : "start"} />
                        {r.enabled ? (
                          <SubmitButton className="btn-ghost inline-flex items-center gap-1 text-xs text-rose-600 whitespace-nowrap" pendingLabel="停止中…">
                            <Square size={12} /> 停止する
                          </SubmitButton>
                        ) : (
                          <SubmitButton className="btn-accent inline-flex items-center gap-1 text-xs whitespace-nowrap" pendingLabel="開始中…">
                            <Play size={12} /> 開始する
                          </SubmitButton>
                        )}
                      </form>
                      <form action={deleteRuleAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn-ghost inline-flex items-center gap-1 text-xs text-ink/40 whitespace-nowrap" pendingLabel="削除中…">
                          <Trash2 size={12} /> 削除
                        </SubmitButton>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* レシピから追加 */}
      {canControl && availableRecipes.length > 0 && (
        <Section title="レシピから追加" className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {availableRecipes.map((rec) => (
              <div key={rec.key} className="rounded-xl border border-black/[0.06] p-4 flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm text-ink/90">{rec.name}</span>
                  <span className="pill text-[10px] bg-ink/[0.06] text-ink/55">{TRIGGER_LABEL[rec.trigger_type] ?? rec.trigger_type}</span>
                </div>
                <p className="text-xs text-ink/55 flex-1 mb-2">{rec.description}</p>
                <form action={createRuleFromRecipeAction}>
                  <input type="hidden" name="recipe_key" value={rec.key} />
                  <SubmitButton className="btn-ghost inline-flex items-center gap-1 text-xs text-teal-700 whitespace-nowrap" pendingLabel="追加中…">
                    <Plus size={12} /> このルールを追加
                  </SubmitButton>
                </form>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 発火履歴 */}
      <Section title="最近の発火（直近20件）">
        {runs.length === 0 ? (
          <EmptyState message="まだ発火履歴はありません。ルールを有効化するとここに記録されます。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50 border-b border-black/[0.06]">
                  <th className="py-2 pr-4">発火時刻</th>
                  <th className="py-2 pr-4">ルール</th>
                  <th className="py-2 pr-4">結果</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-black/[0.03]">
                    <td className="py-2 pr-4 text-ink/70 whitespace-nowrap">{formatDateTimeJst(run.fired_at)}</td>
                    <td className="py-2 pr-4 text-ink/80">{ruleNameById.get(run.rule_id) ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`pill text-[10px] font-bold ${run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "partial" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                        {run.status === "success" ? "成功" : run.status === "partial" ? "一部失敗" : run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="text-xs text-ink/40 mt-4">
        発火はバッチ方式（cronが変更ログを走査→ルール評価→アクション）。Slack送信には SLACK_WEBHOOK_URL の設定が必要です。
        自動化ジョブ全体の停止は「AIバッチ運用」画面の automation ジョブで行えます。
      </p>
    </div>
  );
}
