import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail-view";
import { DetailPane } from "@/components/opportunities/detail-pane";

/**
 * 案件一覧からのクリックを横取りして、詳細をスライドオーバーで表示する
 * インターセプトルート。一覧はマウントされたまま（検索状態を保持）。
 * 直リンク/リロード時はこのルートはマッチせず、フルページ([id]/page.tsx)になる。
 */
export default async function InterceptedOpportunityDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <DetailPane oppId={params.id}>
      <OpportunityDetailView id={params.id} inPane />
    </DetailPane>
  );
}
