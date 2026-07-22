import { MeetingDetailView } from "@/components/meetings/meeting-detail-view";
import { DetailPane } from "@/components/opportunities/detail-pane";

/**
 * 案件一覧のスライドオーバー内で商談をクリックしたときに横取りして、
 * 商談メモをペイン内に表示するインターセプトルート。
 * 一覧はマウントされたまま＝絞り込み状態は維持される。「案件に戻る」で案件詳細へ。
 * 直リンク/リロード時はマッチせず、従来のフルページになる。
 */
export default async function InterceptedMeetingDetail({ params }: { params: { id: string; mid: string } }) {
  return (
    <DetailPane
      title="商談メモ"
      fullHref={`/app/opportunities/${params.id}/meetings/${params.mid}`}
      backHref={`/app/opportunities/${params.id}`}
      backLabel="案件に戻る"
    >
      <MeetingDetailView id={params.id} mid={params.mid} inPane />
    </DetailPane>
  );
}
