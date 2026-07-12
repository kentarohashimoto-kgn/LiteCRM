import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { CardImportForm } from "@/components/business-cards/card-import-form";

export const dynamic = "force-dynamic";

/** 名刺取込（EightのエクスポートCSV/Excel保存CSVに対応）。 */
export default async function BusinessCardImportPage() {
  await requireCtx();
  return (
    <div>
      <Link href="/app/business-cards" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 名刺情報一覧
      </Link>
      <PageHeader
        title="名刺を取込"
        subtitle="Eightの「名刺データダウンロード」で出力したCSVをそのままアップロードできます（Shift_JIS / UTF-8 自動判定）。取込者が名刺交換者として記録されます。"
      />
      <CardImportForm />
    </div>
  );
}
