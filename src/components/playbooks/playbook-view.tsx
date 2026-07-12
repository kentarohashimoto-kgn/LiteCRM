import { Trash2, Plus, Search, Swords } from "lucide-react";
import { Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/utils";
import { createPlaybookAction, deletePlaybookAction } from "@/server/actions/playbooks";
import type { Playbook } from "@/lib/data/playbooks";

const SIZE_BANDS = ["", "小規模(〜50名)", "中小(50〜300名)", "中堅(300〜1000名)", "大手(1000名〜)"];

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="text-xs text-ink/50">
      {label}: <span className="text-ink/70">{value}</span>
    </span>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold text-teal-deep/80 mb-0.5">{label}</div>
      <div className="text-sm text-ink/80 whitespace-pre-wrap leading-relaxed">{value}</div>
    </div>
  );
}

export function PlaybookView({
  items,
  industries,
  q,
  industry,
}: {
  items: Playbook[];
  industries: string[];
  q: string;
  industry: string;
}) {
  return (
    <div className="space-y-6">
      {/* 検索 */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-semibold text-ink/50 mb-1">キーワード検索</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              name="q"
              defaultValue={q}
              placeholder="業種・役職・課題・訴求などで検索"
              className="w-full rounded-lg border border-black/10 pl-9 pr-3 py-2 text-sm focus:border-teal-primary focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink/50 mb-1">業種</label>
          <select name="industry" defaultValue={industry} className="rounded-lg border border-black/10 px-3 py-2 text-sm">
            <option value="">すべて</option>
            {industries.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">検索</button>
        {(q || industry) && <a href="/app/playbooks" className="btn-ghost">クリア</a>}
      </form>

      {/* 新規登録 */}
      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-semibold text-teal-deep flex items-center gap-1.5">
          <Plus size={15} /> 型（プレイブック）を登録する
        </summary>
        <form action={createPlaybookAction} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-ink/50 mb-1">タイトル<span className="text-rose-500">*</span></label>
              <input name="title" required className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 中小・製造の情シス向け AI研修 導入の型" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">業種</label>
              <input name="industry" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 製造 / 建築 / 官公庁" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">会社規模</label>
              <select name="employee_size_band" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
                {SIZE_BANDS.map((b) => (
                  <option key={b} value={b}>{b || "指定なし"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">相手役職</label>
              <input name="target_role" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 経営者 / 情シス / 現場責任者" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">想定課題</label>
              <textarea name="hypothesis_issues" rows={3} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">刺さる訴求</label>
              <textarea name="value_props" rows={3} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">初回質問リスト</label>
              <textarea name="key_questions" rows={3} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">提案の流れ</label>
              <textarea name="proposal_flow" rows={3} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">反論と切り返し</label>
              <textarea name="objections" rows={3} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink/50 mb-1">決裁の勘所</label>
              <textarea name="decision_tips" rows={3} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end">
            <SubmitButton className="btn-primary" pendingLabel="登録中…">登録する</SubmitButton>
          </div>
        </form>
      </details>

      {/* 一覧 */}
      <Section title={`型（${items.length}）`} icon={<Swords size={15} className="text-teal-primary" />}>
        {items.length === 0 ? (
          <EmptyState message={q || industry ? "該当する型がありません。条件を変えてください。" : "まだ型がありません。上の「登録する」から、業種×規模×役職の勝ち筋を蓄積しましょう。橋本さんインタビューや成約商談の共通点が起点になります。"} />
        ) : (
          <div className="space-y-4">
            {items.map((p) => {
              const decided = p.win_count + p.loss_count;
              return (
                <div key={p.id} className="rounded-lg border border-black/[0.06] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{p.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Meta label="業種" value={p.industry} />
                        <Meta label="規模" value={p.employee_size_band} />
                        <Meta label="役職" value={p.target_role} />
                        {decided > 0 && (
                          <span className="text-xs text-ink/50">
                            実績: <span className="text-emerald-600">{p.win_count}勝</span>/<span className="text-rose-600">{p.loss_count}敗</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <form action={deletePlaybookAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-ink/30 hover:text-rose-600 transition-colors shrink-0" title="削除" aria-label="削除">
                        <Trash2 size={15} />
                      </button>
                    </form>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="想定課題" value={p.hypothesis_issues} />
                    <Field label="刺さる訴求" value={p.value_props} />
                    <Field label="初回質問リスト" value={p.key_questions} />
                    <Field label="提案の流れ" value={p.proposal_flow} />
                    <Field label="反論と切り返し" value={p.objections} />
                    <Field label="決裁の勘所" value={p.decision_tips} />
                  </div>
                  <div className="mt-2 text-right text-[11px] text-ink/35">{formatDate(p.created_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
