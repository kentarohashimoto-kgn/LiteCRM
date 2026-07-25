import { Link2, Trash2, TriangleAlert, Archive } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { listDocuments, gdriveConnectionStatus, attachDriveLinkAction, deleteDocumentAction, type DocumentTargetType } from "@/server/actions/documents";
import { DriveUploadForm } from "@/components/documents/drive-upload-form";
import { CATEGORIES_BY_TARGET, SNAPSHOT_FORCED, SNAPSHOT_DEFAULT_ON } from "@/lib/storage/doc-categories";

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
 * P1/P1.5 統合ドキュメント: Googleドライブを原本とする資料の添付。
 * ①アップロード: 種別を選ぶだけでドライブの所定フォルダへ自動振り分け(+証跡は静止点保存)
 * ②リンク貼り付け: ドライブ上のどこにあるファイルでもURLで紐づく
 * 実体コピーはSupabaseに持たない(静止点を除く)。
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
  const [docs, status] = await Promise.all([listDocuments(targetType, targetId), gdriveConnectionStatus()]);
  const categories = CATEGORIES_BY_TARGET[targetType] ?? CATEGORIES_BY_TARGET.library;

  return (
    <Section title={`ドライブ資料（${docs.length}）`} action={<span className="text-[11px] text-ink/40">原本はGoogleドライブ・CRMはリンク管理</span>}>
      {docs.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">
          ファイルをアップロード（種別で自動振り分け）するか、ドライブ上の既存ファイルのURLを貼って紐づけます
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
              {d.has_snapshot ? (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] text-ink/55" title="その時点の固定コピーを保管済み(証跡)">
                  <Archive size={11} /> 静止点
                </span>
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
      {!status.connected ? (
        <p className="text-xs text-ink/40">
          Googleドライブ未接続のため利用できません。管理者が設定画面の「Googleドライブ連携」から接続してください。
        </p>
      ) : (
        <div className="space-y-3">
          {status.canWrite ? (
            <DriveUploadForm
              targetType={targetType}
              targetId={targetId}
              revalidate={revalidatePath}
              categories={[...categories]}
              snapshotForced={[...SNAPSHOT_FORCED]}
              snapshotDefaultOn={[...SNAPSHOT_DEFAULT_ON]}
            />
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              アップロードには書込権限が必要です。管理者が設定画面の「Googleドライブ連携」で<strong>再接続</strong>すると有効になります（リンク貼り付けは下でそのまま使えます）
            </p>
          )}
          <form action={attachDriveLinkAction} className="flex items-center gap-2 flex-wrap">
            <input type="hidden" name="target_type" value={targetType} />
            <input type="hidden" name="target_id" value={targetId} />
            <input type="hidden" name="revalidate" value={revalidatePath} />
            <input
              type="url"
              name="drive_url"
              required
              placeholder="または https://drive.google.com/... のURLを貼り付け"
              className="flex-1 min-w-[240px] rounded-xl border border-black/10 px-3 py-1.5 text-sm"
            />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
              <Link2 size={14} /> リンクを登録
            </button>
          </form>
        </div>
      )}
    </Section>
  );
}
