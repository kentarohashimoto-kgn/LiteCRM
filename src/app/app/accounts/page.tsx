import Link from "next/link";
import { Plus } from "lucide-react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { AccountsPaginatedTable } from "@/components/accounts/accounts-paginated-table";
import type { AccountsPage } from "@/lib/data/accounts-page";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  // 初期50件(集計込み)＋フィルタ用の小データのみ取得。全案件1.3MBの取得を回避。
  const [pageR, ownersR, distinctR] = await Promise.all([
    sb.rpc("accounts_page", { p_filter: {}, p_sort: "revenue", p_asc: false, p_limit: 50, p_offset: 0 }),
    sb.from("profiles").select("id,display_name,email"),
    sb.from("accounts").select("area,industry"),
  ]);
  const page = (pageR.data ?? { rows: [], total: 0 }) as AccountsPage;
  const owners = (ownersR.data ?? []).map((p) => ({ id: p.id as string, name: (p.display_name as string) ?? (p.email as string) ?? "—" }));
  const areaSet = new Set<string>();
  const industrySet = new Set<string>();
  for (const a of distinctR.data ?? []) {
    if (a.area) areaSet.add(a.area as string);
    if (a.industry) industrySet.add(a.industry as string);
  }
  const areas = Array.from(areaSet).sort((a, b) => a.localeCompare(b, "ja"));
  const industries = Array.from(industrySet).sort((a, b) => a.localeCompare(b, "ja"));

  return (
    <div>
      <PageHeader
        title="顧客"
        subtitle="累積売上の高い順で追客優先度を可視化。スクロールで追加読込。エリア・業種・担当営業で絞り込み。"
        action={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
            <Link href="/app/srank" className="text-xs font-semibold text-teal-primary hover:underline">Sランク攻略 →</Link>
            <Link href="/app/nurture" className="text-xs font-semibold text-teal-primary hover:underline">既存顧客深耕 →</Link>
            <LinkButton href="/app/accounts/new" variant="accent"><Plus size={16} /> 顧客を追加</LinkButton>
          </div>
        }
      />
      <AccountsPaginatedTable
        initialRows={page.rows}
        initialTotal={page.total}
        owners={owners}
        areas={areas}
        industries={industries}
      />
    </div>
  );
}
