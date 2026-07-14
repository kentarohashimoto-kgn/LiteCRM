import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { PageHeader } from "@/components/ui/primitives";
import { CardImportForm } from "@/components/business-cards/card-import-form";

export const dynamic = "force-dynamic";

/** 名刺取込（EightのエクスポートCSV/Excel保存CSVに対応）。 */
export default async function BusinessCardImportPage() {
  const ctx = await requireCtx();
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  return (
    <div>
      <Link href="/app/business-cards" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 名刺情報一覧
      </Link>
      <PageHeader
        title="名刺を取込"
        subtitle="Eightの「名刺データダウンロード」で出力したCSVをそのままアップロードできます（Shift_JIS / UTF-8 自動判定）。名刺交換者を選んで取り込めます（既定は取込者）。"
      />
      <CardImportForm members={members} currentUserId={ctx.userId} />
    </div>
  );
}
