import { Link2, Trash2, TriangleAlert } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { listDocuments, gdriveConnected, attachDriveLinkAction, deleteDocumentAction, type DocumentTargetType } from "@/server/actions/documents";

function fmtDate(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

const HEALTH_LABEL: Record<string, string> = {
  deleted: "リンク切れ(削除済み)",
  forbidden: "アクセス不可",
  moved: "移動された可能性",
};

/**
 * P1 統合ドキュメント台帳: Googleドライブのファイルを「リンク」で添付する。
 * 実体はドライブ側が原本(コピーしない)。カテゴリはフォルダから自動判定。
 * アップロード添付(実体保存)は従来の AttachmentSection と併存する。
 */
export async function DocumentSection({
  targetType,
  targetId,
  revalidatePath,
}: {
  targetType: DocumentTargetType;
  targetId: string;
  revalidatePath: string;
}) {
  const [docs, connected] = await Promise.all([listDocuments(targetType, targetId), gdriveConnected()]);

  return (
    <Section title={`ドライブ資料（${docs.length}）`} action={<span className="text-[11px] text-ink/40">原本はGoogleドライブ・リンクのみ登録</span>}>
      {docs.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">
          共有ドライブ上の提案書・資料のURLを貼ると、リンクとして紐づきます（ファイルはコピーされません）
        </p>
      ) : (
        <ul className="space-y-2 mb-3">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 text-sm">
              <Link2 size={14} className="text-ink/35 shrink-0" />
              {d.web_url && d.link_status === "ok" ? (
                <a href={d.web_url} target="_blank" rel="noreferrer" className="text-teal-deep hover:underline truncate min-w-0">
                  {d.title}
                </a>
              ) : (
                <span className="text-ink/70 truncate min-w-0">{d.title}</span>
              )}
              {d.category ? (
                <span className="shrink-0 rounded-full bg-teal-light px-2 py-0.5 text-[11px] text-teal-deep">{d.category}</span>
              ) : null}
              {d.link_status !== "ok" ? (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-600">
                  <TriangleAlert size={11} /> {HEALTH_LABEL[d.link_status] ?? d.link_status}
                </span>
              ) : null}
              <span className="text-xs text-ink/40 shrink-0 ml-auto">{fmtDate(d.created_at)}</span>
              <form action={deleteDocumentAction} className="shrink-0">
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="revalidate" value={revalidatePath} />
                <button type="submit" className="text-ink/30 hover:text-rose-500" aria-label={`${d.title} のリンクを外す`}>
                  <Trash2 size={14} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {connected ? (
        <form action={attachDriveLinkAction} className="flex items-center gap-2 flex-wrap">
          <input type="hidden" name="target_type" value={targetType} />
          <input type="hidden" name="target_id" value={targetId} />
          <input type="hidden" name="revalidate" value={revalidatePath} />
          <input
            type="url"
            name="drive_url"
            required
            placeholder="https://drive.google.com/... のURLを貼り付け"
            className="flex-1 min-w-[240px] rounded-xl border border-black/10 px-3 py-1.5 text-sm"
          />
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
            <Link2 size={14} /> リンクを登録
          </button>
        </form>
      ) : (
        <p className="text-xs text-ink/40">
          Googleドライブ未接続のため利用できません。管理者が設定画面の「Googleドライブ連携」から接続してください。
        </p>
      )}
    </Section>
  );
}
