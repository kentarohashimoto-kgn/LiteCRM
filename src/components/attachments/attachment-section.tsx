import { Paperclip, Trash2, Upload } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { listAttachments, uploadAttachmentAction, deleteAttachmentAction } from "@/server/actions/attachments";

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * C-3 ファイル添付: 提案書・見積・名刺画像などを案件/顧客に添付する。
 * 実体は Supabase Storage(非公開バケット)、リンクは1時間有効の署名URL。
 */
export async function AttachmentSection({
  targetType,
  targetId,
  revalidatePath,
}: {
  targetType: "opportunity" | "account";
  targetId: string;
  revalidatePath: string;
}) {
  const files = await listAttachments(targetType, targetId);

  return (
    <Section title={`添付ファイル（${files.length}）`}>
      {files.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">提案書・見積・名刺画像などを添付できます（10MBまで）</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2.5 text-sm">
              <Paperclip size={14} className="text-ink/35 shrink-0" />
              {f.url ? (
                <a href={f.url} target="_blank" rel="noreferrer" className="text-teal-deep hover:underline truncate min-w-0">
                  {f.file_name}
                </a>
              ) : (
                <span className="text-ink/70 truncate min-w-0">{f.file_name}</span>
              )}
              <span className="text-xs text-ink/40 shrink-0 ml-auto">{fmtSize(f.size_bytes)} ・ {fmtDate(f.created_at)}</span>
              <form action={deleteAttachmentAction} className="shrink-0">
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="revalidate" value={revalidatePath} />
                <button type="submit" className="text-ink/30 hover:text-rose-500" aria-label={`${f.file_name} を削除`}>
                  <Trash2 size={14} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={uploadAttachmentAction} className="flex items-center gap-2 flex-wrap">
        <input type="hidden" name="target_type" value={targetType} />
        <input type="hidden" name="target_id" value={targetId} />
        <input type="hidden" name="revalidate" value={revalidatePath} />
        <input type="file" name="file" required className="text-sm text-ink/60 file:mr-2 file:rounded-lg file:border-0 file:bg-teal-light file:px-3 file:py-1.5 file:text-sm file:text-teal-deep file:cursor-pointer" />
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
          <Upload size={14} /> アップロード
        </button>
      </form>
    </Section>
  );
}
