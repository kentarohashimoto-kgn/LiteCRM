import { MeetingDetailView } from "@/components/meetings/meeting-detail-view";

/**
 * 商談メモのフルページ。直リンク/リロード・他画面からの遷移で表示される。
 * 案件一覧・カレンダーからのクリックは `/app/opportunities/[id]?mid=[mid]` を使い、
 * 並列ルートのスライドオーバー（@detail/(.)[id]）が横取りする。
 */
export default async function MeetingDetailPage(
  props: { params: Promise<{ id: string; mid: string }>; searchParams: Promise<{ saved?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return <MeetingDetailView oppId={params.id} mid={params.mid} saved={searchParams.saved} />;
}
