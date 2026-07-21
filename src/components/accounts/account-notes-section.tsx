import { Trash2, Sparkles, Gauge, Smile } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateFull } from "@/lib/utils";
import { listAccountNotes, type AccountNote } from "@/lib/data/account-notes";
import { createAccountNoteAction, deleteAccountNoteAction } from "@/server/actions/account-notes";

/**
 * 顧客メモ欄。顧客に紐づくメモ(手入力＋AIリサーチ結果)を顧客詳細画面に表示する。
 * AIリサーチのメモ(kind='ai_research')は、満足度・業務課題解決度の10段階スコアを
 * ゲージで可視化し、やりとりのタイムラインと戦略提言を本文に表示する。
 */
export async function AccountNotesSection({ accountId }: { accountId: string }) {
  const notes = await listAccountNotes(accountId);

  return (
    <Section
      title={`顧客メモ（${notes.length}）`}
      icon={<Sparkles size={15} className="text-teal-primary mr-1.5" />}
      action={<span className="text-[11px] text-ink/40">顧客とのやりとり・分析・次の一手を集約</span>}
    >
      {notes.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">メモはまだありません。下のフォームから追加できます。</p>
      ) : (
        <ul className="space-y-4 mb-5">
          {notes.map((n) => (
            <li key={n.id}>{n.kind === "ai_research" ? <AiResearchNote note={n} /> : <GeneralNote note={n} />}</li>
          ))}
        </ul>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ メモを追加</summary>
        <form action={createAccountNoteAction} className="mt-3 space-y-3 border-t border-black/[0.05] pt-3">
          <input type="hidden" name="account_id" value={accountId} />
          <div>
            <label className="label">タイトル（任意）</label>
            <input name="title" className="input" placeholder="例：次回提案の論点メモ" />
          </div>
          <div>
            <label className="label">メモ *</label>
            <textarea name="body" required rows={4} className="input" placeholder="顧客とのやりとり・気づき・次のアクションなど" />
          </div>
          <SubmitButton className="btn-accent" pendingLabel="保存中…">メモを保存</SubmitButton>
        </form>
      </details>
    </Section>
  );
}

/** AIリサーチメモ: スコア可視化つきの強調カード。 */
function AiResearchNote({ note }: { note: AccountNote }) {
  return (
    <div className="rounded-2xl border border-teal-primary/25 bg-teal-light/40 p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="pill bg-teal-primary text-white text-[10px] inline-flex items-center gap-1">
          <Sparkles size={11} /> AI分析
        </span>
        <span className="text-sm font-semibold text-ink">{note.title ?? "顧客分析"}</span>
        <span className="text-[11px] text-ink/40 ml-auto">{formatDateFull(note.created_at)}</span>
      </div>

      {(note.satisfaction_score != null || note.potential_score != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {note.satisfaction_score != null && (
            <ScoreGauge
              label="カトルセ満足度"
              icon={<Smile size={13} />}
              score={note.satisfaction_score}
              tone="teal"
            />
          )}
          {note.potential_score != null && (
            <ScoreGauge
              label="業務課題解決ポテンシャル"
              icon={<Gauge size={13} />}
              score={note.potential_score}
              tone="orange"
            />
          )}
        </div>
      )}

      {note.source_summary && (
        <p className="text-[11px] text-ink/45 mb-2">参照ソース: {note.source_summary}</p>
      )}

      <NoteBody body={note.body} />

      <form action={deleteAccountNoteAction} className="mt-2 flex justify-end">
        <input type="hidden" name="id" value={note.id} />
        <input type="hidden" name="account_id" value={note.account_id} />
        <button type="submit" className="text-ink/25 hover:text-rose-500" aria-label="このメモを削除">
          <Trash2 size={13} />
        </button>
      </form>
    </div>
  );
}

/** 手入力メモ: シンプルなカード。 */
function GeneralNote({ note }: { note: AccountNote }) {
  return (
    <div className="rounded-xl border border-black/[0.06] p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        {note.title && <span className="text-sm font-semibold text-ink">{note.title}</span>}
        <span className="text-[11px] text-ink/40 ml-auto">{formatDateFull(note.created_at)}</span>
      </div>
      <NoteBody body={note.body} />
      <form action={deleteAccountNoteAction} className="mt-1.5 flex justify-end">
        <input type="hidden" name="id" value={note.id} />
        <input type="hidden" name="account_id" value={note.account_id} />
        <button type="submit" className="text-ink/25 hover:text-rose-500" aria-label="このメモを削除">
          <Trash2 size={13} />
        </button>
      </form>
    </div>
  );
}

/** 10段階スコアのゲージ。0-10を10分割のバーで可視化する。 */
function ScoreGauge({
  label,
  icon,
  score,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  score: number;
  tone: "teal" | "orange";
}) {
  const v = Math.max(0, Math.min(10, score));
  const fill = tone === "orange" ? "bg-accent-orange" : "bg-teal-primary";
  return (
    <div className="rounded-xl bg-white/70 border border-black/[0.05] px-3 py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-ink/60 inline-flex items-center gap-1">
          {icon} {label}
        </span>
        <span className="text-sm font-bold tabular-nums text-ink">
          {v}
          <span className="text-[11px] font-normal text-ink/40"> /10</span>
        </span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-sm ${i < v ? fill : "bg-mist-soft"}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * メモ本文の軽量レンダラ。依存を増やさず、改行・見出し(##)・箇条書き(-/・)・
 * 強調(**...**)・区切り線(---)だけを解釈する。
 */
function NoteBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="text-[13px] leading-relaxed text-ink/80 space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === "") return <div key={i} className="h-1.5" />;
        if (trimmed === "---") return <hr key={i} className="my-2 border-black/[0.06]" />;
        if (trimmed.startsWith("### ")) {
          return <h4 key={i} className="text-[13px] font-bold text-ink mt-2">{renderInline(trimmed.slice(4))}</h4>;
        }
        if (trimmed.startsWith("## ")) {
          return <h3 key={i} className="text-sm font-bold text-teal-deep mt-3 mb-0.5">{renderInline(trimmed.slice(3))}</h3>;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("・")) {
          const text = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed.slice(1);
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-teal-primary shrink-0">・</span>
              <span className="min-w-0">{renderInline(text)}</span>
            </div>
          );
        }
        return <p key={i}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

/** **強調** のみ解釈するインラインレンダラ。 */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
