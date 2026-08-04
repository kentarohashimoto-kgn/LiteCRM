import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Download, ShieldCheck } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { queryAuditEvents, auditActionLabel, AUDIT_ACTION_LABELS, type AuditFilters } from "@/lib/data/audit-events";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/** JSTで「M/D HH:mm」表記。 */
function fmtJst(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function AuditPage(
  props: {
    searchParams: Promise<{ action?: string; user?: string; from?: string; to?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  if (!["owner", "admin"].includes(ctx.role)) redirect("/app/dashboard");

  const clean = (v?: string) => (v ?? "").trim() || undefined;
  const filters: AuditFilters = {
    action: clean(searchParams.action),
    userId: clean(searchParams.user),
    from: clean(searchParams.from),
    to: clean(searchParams.to),
    page: searchParams.page ? Math.max(1, parseInt(searchParams.page, 10) || 1) : 1,
    pageSize: PAGE_SIZE,
  };

  const sb = getSupabaseServer();
  const [{ rows, total }, profilesR] = await Promise.all([
    queryAuditEvents(filters),
    sb.from("profiles").select("id, display_name"),
  ]);
  const profiles = (profilesR.data ?? []) as { id: string; display_name: string | null }[];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.userId) params.set("user", filters.userId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = (page: number) => {
    const p = new URLSearchParams(params);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportHref = `/app/settings/audit/export${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <div>
      <Link href="/app/settings" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 設定
      </Link>
      <PageHeader
        title="監査ログ"
        subtitle="ログインと重い処理（取込・書き出し・名寄せ・マッチング）を記録します。閲覧は管理者のみ。"
        action={
          <a href={exportHref} className="btn-ghost inline-flex items-center gap-1.5">
            <Download size={15} /> CSV抽出
          </a>
        }
      />

      {/* 絞り込み */}
      <form method="GET" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <label className="block">
          <span className="block text-[11px] text-ink/50 mb-1">操作</span>
          <select name="action" defaultValue={filters.action ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
            <option value="">すべて</option>
            {Object.keys(AUDIT_ACTION_LABELS).map((a) => (
              <option key={a} value={a}>{auditActionLabel(a)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-ink/50 mb-1">ユーザー</span>
          <select name="user" defaultValue={filters.userId ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
            <option value="">すべて</option>
            {profiles.filter((p) => p.display_name).sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? "", "ja")).map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-ink/50 mb-1">期間（開始）</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className="w-full rounded-lg border border-black/10 px-2 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-ink/50 mb-1">期間（終了）</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className="w-full rounded-lg border border-black/10 px-2 py-2 text-sm" />
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary">絞り込み</button>
          {(filters.action || filters.userId || filters.from || filters.to) && (
            <Link href="/app/settings/audit" className="text-sm text-ink/50 hover:text-ink">クリア</Link>
          )}
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 900 }}>
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th whitespace-nowrap">日時</th>
              <th className="th">ユーザー</th>
              <th className="th">操作</th>
              <th className="th">対象</th>
              <th className="th">詳細</th>
              <th className="th whitespace-nowrap">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => (
              <tr key={r.id} className="row-hover align-top">
                <td className="td whitespace-nowrap text-xs text-ink/70">{fmtJst(r.created_at)}</td>
                <td className="td whitespace-nowrap">{(r.user_id && nameById.get(r.user_id)) || r.actor_email || "—"}</td>
                <td className="td whitespace-nowrap">
                  <span className="pill bg-mist-soft text-ink/70 text-[11px]">{auditActionLabel(r.action)}</span>
                </td>
                <td className="td text-xs text-ink/70">{r.target ?? "—"}</td>
                <td className="td text-xs text-ink/50 max-w-72">
                  <div className="truncate" title={r.meta ? JSON.stringify(r.meta) : ""}>
                    {r.meta && Object.keys(r.meta).length ? JSON.stringify(r.meta) : "—"}
                  </div>
                </td>
                <td className="td text-xs text-ink/40 whitespace-nowrap">{r.ip ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="td text-center text-ink/40 py-10">該当するログがありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="text-ink/50">
            {total.toLocaleString()}件中 {((filters.page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(filters.page * PAGE_SIZE, total).toLocaleString()}件
          </div>
          <div className="flex items-center gap-2">
            {filters.page > 1 ? <Link href={`/app/settings/audit${qs(filters.page - 1)}`} className="btn-ghost">← 前へ</Link> : <span className="btn-ghost opacity-40 pointer-events-none">← 前へ</span>}
            <span className="text-ink/50">{filters.page} / {pages}</span>
            {filters.page < pages ? <Link href={`/app/settings/audit${qs(filters.page + 1)}`} className="btn-ghost">次へ →</Link> : <span className="btn-ghost opacity-40 pointer-events-none">次へ →</span>}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-ink/40 flex items-center gap-1.5">
        <ShieldCheck size={13} />
        通常の閲覧・クリックは記録しません（データ量とレスポンスに配慮）。記録対象はログインと重い処理のみです。
      </p>
    </div>
  );
}
