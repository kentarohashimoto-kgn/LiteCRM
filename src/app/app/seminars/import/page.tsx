import { getWorkspaceLite } from "@/lib/data/workspace";
import { listCampaignsByChannel, getLeadSources } from "@/lib/data/select";
import { PageHeader } from "@/components/ui/primitives";
import { SeminarImportForm } from "@/components/seminars/seminar-import-form";

export default async function SeminarImportPage() {
  const ws = await getWorkspaceLite();
  const campaigns = listCampaignsByChannel(ws, "seminar").map((c) => ({ id: c.id, name: c.name, event_date: c.event_date }));
  const leadSources = getLeadSources(ws).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div>
      <PageHeader
        title="セミナー取込"
        subtitle="参加者リスト・アンケート回答を取り込みます。メール一致は既存リードへ接点追加（ナーチャリング）、未登録は新規リード化します。"
      />
      <SeminarImportForm campaigns={campaigns} leadSources={leadSources} />
    </div>
  );
}
