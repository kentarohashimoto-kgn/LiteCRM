import { HardDriveDownload, RefreshCw } from "lucide-react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { formatDateFull } from "@/lib/utils";

const ERROR_LABEL: Record<string, string> = {
  no_google: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です",
  no_secret: "MAIL_CRED_SECRET が未設定です（トークン暗号化に必要）",
  gdrive_denied: "Google側で接続が拒否されました",
  gdrive_state: "セッションが無効です。もう一度お試しください",
  gdrive_exchange: "トークン交換に失敗しました",
  gdrive_save: "接続情報の保存に失敗しました",
  forbidden: "この操作は管理者のみ実行できます",
};

/**
 * P1 Googleドライブ組織接続の状態表示と接続ボタン(設定画面・管理者のみ)。
 * 接続アカウントは共有ドライブ(601/602)を閲覧できる代表アカウントを使う。
 * OAuthクライアントに drive.readonly スコープと
 * /api/oauth/gdrive/callback リダイレクトURIの追加が必要(.env.example参照)。
 */
export async function GdriveConnectionCard({ searchParams }: { searchParams: { saved?: string; error?: string; detail?: string } }) {
  await requireCtx();
  const sb = getSupabaseServer(); // RLS: owner/admin のみ参照可
  const { data } = await sb
    .from("tenant_storage_connections")
    .select("display_name, status, updated_at")
    .eq("provider", "gdrive")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const conn = data as { display_name: string; status: string; updated_at: string } | null;

  return (
    <div className="max-w-3xl">
      {searchParams.saved === "gdrive_connected" && (
        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">Googleドライブを接続しました</p>
      )}
      {searchParams.error && ERROR_LABEL[searchParams.error] && (
        <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3">
          {ERROR_LABEL[searchParams.error]}
          {searchParams.detail ? `（${searchParams.detail}）` : ""}
        </p>
      )}
      <p className="text-sm text-ink/60 mb-3">
        資料のアップロード（種別でドライブの所定フォルダへ自動振り分け）と、ドライブ上の任意のファイルのリンク添付を有効にします。
        接続アカウントには対象共有ドライブ（601_CRM_資料庫 / 603_CRM_BO 等）の編集権限が必要です。
        ※読み取り専用時代に接続した場合、アップロード有効化には「再接続」が必要です。
      </p>
      {conn && conn.status === "active" ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm">
            接続中: <span className="font-medium">{conn.display_name}</span>
            <span className="text-xs text-ink/40 ml-2">最終更新 {formatDateFull(conn.updated_at)}</span>
          </span>
          <a href="/api/oauth/gdrive/start" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
            <RefreshCw size={14} /> 再接続
          </a>
        </div>
      ) : (
        <a href="/api/oauth/gdrive/start" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
          <HardDriveDownload size={15} /> Googleドライブを接続
        </a>
      )}
    </div>
  );
}
