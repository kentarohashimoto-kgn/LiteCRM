import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail-view";
import { MeetingDetailView } from "@/components/meetings/meeting-detail-view";

/**
 * 案件詳細フルページ。直リンク/リロード・他画面からの遷移で表示される。
 * 案件一覧・カレンダーからのクリックは並列ルートのスライドオーバー（@detail/(.)[id]）が横取りする。
 * `?mid=` 付きは商談メモ（スライドオーバーと同じ内容）を表示する。ペインのURLを
 * そのまま開き直した／リロードした場合でも同じ画面になるようにするため。
 */
export default async function OpportunityDetailPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ error?: string; saved?: string; mid?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (searchParams.mid) {
    return <MeetingDetailView oppId={params.id} mid={searchParams.mid} saved={searchParams.saved} />;
  }
  return <OpportunityDetailView id={params.id} saved={searchParams.saved} error={searchParams.error} />;
}
