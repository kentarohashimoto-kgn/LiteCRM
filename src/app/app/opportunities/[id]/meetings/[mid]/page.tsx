import { MeetingDetailView } from "@/components/meetings/meeting-detail-view";

/**
 * 商談メモのフルページ。直リンク/リロード・他画面からの遷移で表示される。
 * 案件一覧からのクリックは並列ルートのスライドオーバー（@detail）が横取りする。
 */
export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: { id: string; mid: string };
  searchParams: { saved?: string };
}) {
  return <MeetingDetailView id={params.id} mid={params.mid} saved={searchParams.saved} />;
}
