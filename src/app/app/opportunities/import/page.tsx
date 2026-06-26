import { PageHeader } from "@/components/ui/primitives";
import { DealImportForm } from "@/components/deals/deal-import-form";

export const dynamic = "force-dynamic";

export default function DealImportPage() {
  return (
    <div>
      <PageHeader
        title="商談取込（Notionヨミ表 → 案件）"
        subtitle="Notion「商談ヨミ表」のCSVをアップロードし、顧客→案件→商談ログ へ全置換で取り込みます。何度でも再同期できます。"
      />
      <DealImportForm />
    </div>
  );
}
