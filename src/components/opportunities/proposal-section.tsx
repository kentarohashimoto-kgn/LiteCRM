import { ExternalLink, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_MAP } from "@/lib/constants";
import {
  listProposalVersions,
  setProposalRequiredAction,
  updateProposalMetaAction,
  addProposalVersionAction,
  deleteProposalVersionAction,
} from "@/server/actions/proposals";

/**
 * 案件詳細の「提案書」セクション。
 * 既定は「提案書なしで成約」= フラグOFF。開発案件・大型案件で提案が必要と見極めたら
 * フラグを立て、進捗・提出期限・提出バージョン(URL/添付・最新判定)を管理する。
 */
export async function ProposalSection({
  opportunityId,
  proposalRequired,
  proposalStatus,
  proposalDueDate,
}: {
  opportunityId: string;
  proposalRequired: boolean;
  proposalStatus: string | null;
  proposalDueDate: string | null;
}) {
  const versions = proposalRequired ? await listProposalVersions(opportunityId) : [];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = proposalRequired && proposalDueDate && proposalDueDate < today && proposalStatus !== "submitted";
  const st = PROPOSAL_STATUS_MAP[proposalStatus ?? "not_started"];

  return (
    <Section
      title="提案書"
      action={
        proposalRequired ? (
          <span className={`pill ${st?.color ?? "bg-black/[0.05] text-ink/50"}`}>{st?.label ?? "未設定"}</span>
        ) : (
          <span className="text-[11px] text-ink/40">既定: 提案書なしで成約を狙う</span>
        )
      }
    >
      {!proposalRequired ? (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-ink/50 flex-1 min-w-[200px]">
            この案件は提案書なしで進めます。開発案件・大型案件などソリューション提案で差別化する場合はフラグを立ててください。
          </p>
          <form action={setProposalRequiredAction}>
            <input type="hidden" name="opportunity_id" value={opportunityId} />
            <input type="hidden" name="required" value="1" />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-teal-primary/40 bg-teal-light text-teal-deep px-3 py-1.5 text-sm hover:bg-teal-light/70">
              <FileText size={14} /> 提案書が必要な案件にする
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 進捗・期限 */}
          <form action={updateProposalMetaAction} className="flex items-end gap-2.5 flex-wrap">
            <input type="hidden" name="opportunity_id" value={opportunityId} />
            <div>
              <label className="label">進捗</label>
              <select name="proposal_status" defaultValue={proposalStatus ?? "not_started"} className="input w-auto">
                {PROPOSAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">提出期限</label>
              <input type="date" name="proposal_due_date" defaultValue={proposalDueDate ?? ""} className={`input w-auto ${overdue ? "border-rose-300 text-rose-600" : ""}`} />
            </div>
            <button type="submit" className="rounded-xl border border-black/10 px-3 py-2 text-sm hover:bg-black/[0.03]">更新</button>
            {overdue && <span className="pill bg-rose-50 text-rose-600">期限超過</span>}
          </form>

          {/* 提出履歴(最新が先頭) */}
          {versions.length === 0 ? (
            <p className="text-sm text-ink/40">まだ提出していません。提出したら下から記録してください(進捗は自動で「提出済み」になります)。</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v, i) => {
                const link = v.url ?? v.fileUrl;
                return (
                  <li key={v.id} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${i === 0 ? "bg-teal-light/30 border border-teal-primary/20" : "bg-black/[0.02]"}`}>
                    <span className={`pill shrink-0 ${i === 0 ? "bg-teal-primary text-white" : "bg-black/[0.06] text-ink/50"}`}>
                      v{v.version}{i === 0 && " 最新"}
                    </span>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-deep hover:underline min-w-0 truncate">
                        {v.url ? <ExternalLink size={13} /> : <Paperclip size={13} />}
                        {v.title ?? `提案書 v${v.version}`}
                      </a>
                    ) : (
                      <span className="text-ink/70 min-w-0 truncate">{v.title ?? `提案書 v${v.version}`}</span>
                    )}
                    {v.note && <span className="text-xs text-ink/45 truncate min-w-0">— {v.note}</span>}
                    <span className="text-xs text-ink/40 shrink-0 ml-auto">{v.submitted_at} 提出</span>
                    <form action={deleteProposalVersionAction} className="shrink-0">
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="opportunity_id" value={opportunityId} />
                      <button type="submit" className="text-ink/25 hover:text-rose-500" aria-label={`v${v.version} を削除`}>
                        <Trash2 size={13} />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 提出を記録 */}
          <details className="rounded-xl bg-black/[0.02] p-3">
            <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 提案書の提出を記録（v{versions.length + 1}）</summary>
            <form action={addProposalVersionAction} className="mt-3 space-y-2.5">
              <input type="hidden" name="opportunity_id" value={opportunityId} />
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="label">タイトル</label>
                  <input name="title" className="input" placeholder={`例: ○○様向けご提案書 v${versions.length + 1}`} />
                </div>
                <div>
                  <label className="label">提出日</label>
                  <input type="date" name="submitted_at" defaultValue={today} className="input" />
                </div>
              </div>
              <div>
                <label className="label">リンク（Google Drive / Box 等のURL）</label>
                <input name="url" type="url" className="input" placeholder="https://…" />
              </div>
              <div>
                <label className="label">またはファイル添付（15MBまで）</label>
                <input type="file" name="file" className="text-sm text-ink/60 file:mr-2 file:rounded-lg file:border-0 file:bg-teal-light file:px-3 file:py-1.5 file:text-sm file:text-teal-deep file:cursor-pointer" />
              </div>
              <div>
                <label className="label">メモ（変更点など）</label>
                <input name="note" className="input" placeholder="例: 価格見直し・スケジュール更新" />
              </div>
              <button type="submit" className="btn-accent inline-flex items-center gap-1.5"><Upload size={14} /> 提出を記録</button>
            </form>
          </details>

          <form action={setProposalRequiredAction}>
            <input type="hidden" name="opportunity_id" value={opportunityId} />
            <input type="hidden" name="required" value="0" />
            <button type="submit" className="text-xs text-ink/40 hover:text-ink underline-offset-2 hover:underline">
              提案書を不要に戻す
            </button>
          </form>
        </div>
      )}
    </Section>
  );
}
