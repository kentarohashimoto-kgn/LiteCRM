import Link from "next/link";
import { ClipboardList, Search, ExternalLink, AlertTriangle } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { CopyArea } from "@/components/marketing/copy-area";
import { listSeoSites } from "@/lib/data/seo";
import { ACTION_PRIORS } from "@/lib/seo/expected-value";
import { updateActionStatusAction } from "@/server/actions/seo";

export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

interface ActionRow {
  id: string;
  title: string;
  action_type: string;
  execution_mode: string;
  target_query: string;
  target_page: string;
  expected_json: Record<string, number>;
  deliverable_md: string | null;
  status: string;
  applied_at: string | null;
  verify_due_at: string | null;
  content_idea_id: string | null;
  note: string | null;
}

/** 状態の並び順と表示名。左から右へ進む。 */
const COLUMNS: Array<{ key: string; label: string; next?: string; nextLabel?: string }> = [
  { key: "todo", label: "未着手", next: "in_progress", nextLabel: "着手する" },
  { key: "in_progress", label: "作業中", next: "waiting_deploy", nextLabel: "反映依頼済みにする" },
  { key: "waiting_deploy", label: "反映待ち", next: "deployed", nextLabel: "反映しました" },
  { key: "deployed", label: "効果検証中", next: "done", nextLabel: "完了にする" },
  { key: "done", label: "完了" },
];

const MODE_LABEL: Record<string, string> = {
  external: "HP側で作業",
  content: "記事パイプライン",
  app: "CRM内で完結",
  manual: "手動",
};

/**
 * 施策の実行ボード（F-303）。
 *
 * 承認 → 成果物 → 反映記録 を1画面で回す。
 * 「反映しました」の記録が効果検証(WO-36)の起点になるため、
 * そこだけは押し忘れが起きないように目立たせる。
 */
export default async function SeoActionsPage({
  searchParams,
}: {
  searchParams: { site?: string; saved?: string; error?: string };
}) {
  await requireCtx();
  const sites = await listSeoSites();
  const active = sites.filter((s) => s.status === "active");
  const current = active.find((s) => s.id === searchParams.site) ?? active[0] ?? sites[0];
  if (!current) {
    return (
      <div>
        <PageHeader title="施策の実行" subtitle="承認した打ち手を、成果物と反映記録まで管理します。" />
        <EmptyState message="計測サイトが未登録です。" />
      </div>
    );
  }

  const sb = getSupabaseServer();
  const { data } = await sb
    .from("seo_actions")
    .select(
      "id, title, action_type, execution_mode, target_query, target_page, expected_json, deliverable_md, status, applied_at, verify_due_at, content_idea_id, note",
    )
    .eq("site_id", current.id)
    .neq("status", "canceled")
    .order("created_at", { ascending: false })
    .limit(100);
  const actions = (data ?? []) as ActionRow[];
  const byStatus = (key: string) => actions.filter((a) => a.status === key);

  return (
    <div className="space-y-5">
      <PageHeader
        title="施策の実行"
        subtitle={`${current.name} — 承認した打ち手の成果物と、反映の記録。反映日から14日後に効果を自動判定します。`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/seo/proposals" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              改善提案
            </Link>
            <Link href="/app/seo" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Search size={14} />
              集客サマリー
            </Link>
          </div>
        }
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          applied: "反映を記録しました。14日後に効果を自動判定します。",
          status: "状態を更新しました。",
        }}
        errorMessages={{ forbidden: "この操作を行う権限がありません。" }}
      />

      {/* 進捗の要約。反映待ちが溜まっていないかを一目で分かるようにする */}
      <div className="flex flex-wrap gap-2 text-xs">
        {COLUMNS.map((c) => (
          <span key={c.key} className="rounded-full border border-black/10 px-3 py-1 text-ink/60">
            {c.label} <strong className="text-ink">{byStatus(c.key).length}</strong>
          </span>
        ))}
      </div>

      {actions.length === 0 ? (
        <EmptyState message="実行中の施策はありません。改善提案を承認すると、ここに実行チケットが作られます。" />
      ) : (
        COLUMNS.filter((c) => byStatus(c.key).length > 0).map((col) => (
          <Section key={col.key} title={`${col.label}（${byStatus(col.key).length}）`} icon={<ClipboardList size={15} />}>
            <div className="space-y-3">
              {byStatus(col.key).map((a) => {
                const prior = ACTION_PRIORS[a.action_type];
                const revenue = Number(a.expected_json?.revenue ?? 0);
                return (
                  <div key={a.id} className="rounded-lg border border-black/[0.06] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{a.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink/50">
                          <span className="rounded bg-black/[0.04] px-1.5 py-0.5">
                            {MODE_LABEL[a.execution_mode] ?? a.execution_mode}
                          </span>
                          {prior && <span>手間 {prior.effort}</span>}
                          {revenue > 0 && <span className="text-teal-700">期待 {yen(revenue)}/月</span>}
                          {a.target_page && <span className="break-all">{a.target_page}</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {a.content_idea_id && (
                          <Link
                            href={`/app/content/${a.content_idea_id}`}
                            className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline"
                          >
                            <ExternalLink size={12} />
                            記事を開く
                          </Link>
                        )}
                        {col.next && (
                          <form action={updateActionStatusAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="site" value={current.id} />
                            <input type="hidden" name="to" value={col.next} />
                            <SubmitButton
                              className={col.next === "deployed" ? "btn-primary text-xs" : "btn-secondary text-xs"}
                              pendingLabel="…"
                            >
                              {col.nextLabel}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </div>

                    {a.note && (
                      <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
                        <span>{a.note}</span>
                      </div>
                    )}

                    {a.applied_at && (
                      <div className="mt-2 text-xs text-ink/50">
                        反映日 {new Date(a.applied_at).toLocaleDateString("ja-JP")}
                        {a.verify_due_at &&
                          ` ／ 効果判定 ${new Date(a.verify_due_at).toLocaleDateString("ja-JP")}`}
                      </div>
                    )}

                    {a.deliverable_md && col.key !== "done" && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-ink/60">
                          指示書を開く（コピーしてHP担当へ渡せます）
                        </summary>
                        <div className="mt-2">
                          <CopyArea text={a.deliverable_md} rows={14} />
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}
