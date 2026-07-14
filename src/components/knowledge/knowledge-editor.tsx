"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2, Save, Paperclip, Link2 } from "lucide-react";
import { saveKnowledgeAction } from "@/server/actions/knowledge";
import type { KnowledgeEntry, KnowledgeKind } from "@/lib/data/knowledge";

const KIND_ORDER: { key: KnowledgeKind; label: string }[] = [
  { key: "knowhow", label: "ノウハウ" },
  { key: "win_reason", label: "成約理由" },
  { key: "loss_reason", label: "失注理由" },
  { key: "case_study", label: "事例" },
];

/**
 * ノウハウ・事例の登録/編集フォーム(クライアント)。
 * 参考URL(複数・説明つき)と添付ファイル1件(説明つき)を扱う。
 * 送信はリダイレクトせずアクション結果を受け取り、成功で閉じて再描画する。
 */
export function KnowledgeEditor({ entry, onDone, onCancel }: { entry?: KnowledgeEntry; onDone?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!entry;

  // 参考URL行(url + 説明)。空1行から始める。
  const [links, setLinks] = useState<{ url: string; label: string }[]>(
    entry && entry.reference_links.length
      ? entry.reference_links.map((l) => ({ url: l.url, label: l.label ?? "" }))
      : [{ url: "", label: "" }],
  );
  // 添付: 既存を保持/削除、または新規選択
  const [fileName, setFileName] = useState<string>("");
  const [removeExisting, setRemoveExisting] = useState(false);

  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await saveKnowledgeAction(fd);
      if (!res.ok) {
        setError(res.error || "保存に失敗しました。");
        return;
      }
      router.refresh();
      if (!isEdit) {
        form.reset();
        setLinks([{ url: "", label: "" }]);
        setFileName("");
      }
      onDone?.();
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      {isEdit && <input type="hidden" name="id" value={entry!.id} />}

      <div>
        <label className="block text-xs font-semibold text-ink/50 mb-1">種別</label>
        <select name="kind" defaultValue={entry?.kind ?? "knowhow"} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
          {KIND_ORDER.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink/50 mb-1">業種(任意)</label>
        <input name="industry" defaultValue={entry?.industry ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 建築 / 製造 / ISP" />
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-semibold text-ink/50 mb-1">タイトル<span className="text-rose-500">*</span></label>
        <input name="title" required defaultValue={entry?.title ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="例: 助成金トークで価格ハードルを下げた / 官公庁は閉域が前提" />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-semibold text-ink/50 mb-1">内容</label>
        <textarea name="body" rows={5} defaultValue={entry?.body ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="どんな状況で・何が効いた/失敗したか。次に活かせる形で。" />
      </div>

      <div>
        <label className="block text-xs font-semibold text-ink/50 mb-1">競合(任意)</label>
        <input name="competitor" defaultValue={entry?.competitor ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="失注理由・事例で該当あれば" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-ink/50 mb-1">タグ(任意・カンマ区切り)</label>
        <input name="tags" defaultValue={(entry?.tags ?? []).join(", ")} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" placeholder="価格, 決裁, 助成金" />
      </div>

      {/* 参考URL(複数・説明つき) */}
      <div className="sm:col-span-2">
        <label className="block text-xs font-semibold text-ink/50 mb-1 flex items-center gap-1"><Link2 size={13} /> 参考URL(任意・複数可)</label>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                name="ref_url"
                value={l.url}
                onChange={(e) => setLinks((xs) => xs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://example.com/…"
                className="flex-1 min-w-[200px] rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
              <input
                name="ref_label"
                value={l.label}
                onChange={(e) => setLinks((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="説明(任意) 例: 提案資料 / 参考記事"
                className="flex-1 min-w-[160px] rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => setLinks((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [{ url: "", label: "" }]))} className="text-ink/30 hover:text-rose-600 shrink-0" title="この行を削除" aria-label="この行を削除">
                <X size={16} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setLinks((xs) => [...xs, { url: "", label: "" }])} className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline">
            <Plus size={13} /> URLを追加
          </button>
        </div>
      </div>

      {/* 添付ファイル1つ(説明つき) */}
      <div className="sm:col-span-2">
        <label className="block text-xs font-semibold text-ink/50 mb-1 flex items-center gap-1"><Paperclip size={13} /> 添付ファイル(任意・1つ・10MBまで)</label>
        {isEdit && entry!.attachment_name && !removeExisting && !fileName && (
          <div className="mb-2 flex items-center gap-2 text-sm text-ink/70">
            <Paperclip size={13} className="text-ink/40" />
            <span className="truncate">{entry!.attachment_name}</span>
            <button type="button" onClick={() => setRemoveExisting(true)} className="text-xs text-rose-500 hover:underline">削除</button>
          </div>
        )}
        {removeExisting && (
          <div className="mb-2 text-xs text-rose-500 flex items-center gap-2">
            添付を削除します
            <input type="hidden" name="remove_attachment" value="1" />
            <button type="button" onClick={() => setRemoveExisting(false)} className="text-ink/50 hover:underline">取り消す</button>
          </div>
        )}
        <input
          type="file"
          name="file"
          onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ""); if (e.target.files?.[0]) setRemoveExisting(false); }}
          className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-lg file:border-0 file:bg-mist-soft file:px-3 file:py-1.5 file:text-sm file:text-ink/70 hover:file:bg-teal-light"
        />
        {(fileName || (isEdit && entry!.attachment_name && !removeExisting)) && (
          <input
            name="attachment_note"
            defaultValue={entry?.attachment_note ?? ""}
            placeholder="資料の説明(任意) 例: 初回商談で使う会社紹介"
            className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input type="checkbox" name="is_own_company" defaultChecked={entry ? entry.is_own_company : true} className="rounded" /> 自社の事例・ノウハウ（外すと他社事例）
      </label>

      <div className="sm:col-span-2 flex items-center justify-end gap-2">
        {error && <span className="text-xs text-rose-600 mr-auto">{error}</span>}
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost text-sm">キャンセル</button>
        )}
        <button type="submit" disabled={pending} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60">
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {isEdit ? "更新する" : "登録する"}
        </button>
      </div>
    </form>
  );
}
