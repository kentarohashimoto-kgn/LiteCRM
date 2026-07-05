import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { TrashPanel } from "@/components/settings/trash-panel";
import { fetchTrashAction } from "@/server/actions/trash";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const ctx = await requireCtx();
  const trash = await fetchTrashAction();
  const canPurge = ctx.role === "owner" || ctx.role === "admin";

  return (
    <div>
      <Link href="/app/settings" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 設定
      </Link>
      <PageHeader
        title="ゴミ箱"
        subtitle="削除したリード・案件・顧客は30日間ここに保管され、復元できます。30日を過ぎると自動的に完全削除されます。"
      />
      <TrashPanel initial={trash} canPurge={canPurge} />
    </div>
  );
}
