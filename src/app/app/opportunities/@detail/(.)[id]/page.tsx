import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail-view";
import { MeetingDetailView } from "@/components/meetings/meeting-detail-view";
import { DetailPane } from "@/components/opportunities/detail-pane";

/**
 * 案件一覧・カレンダーからのクリックを横取りして、詳細をスライドオーバーで表示する
 * インターセプトルート。一覧/カレンダーはマウントされたまま（表示週・絞り込みを保持）。
 * 直リンク/リロード時はこのルートはマッチせず、フルページ([id]/page.tsx)になる。
 *
 * `?mid=` が付いていれば商談メモを、無ければ案件詳細を同じペインに描画する。
 * 商談 → 案件 → 商談 とペイン内で行き来しても、背後のカレンダーは動かない。
 */
export default async function InterceptedOpportunityDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mid?: string; saved?: string; error?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const mid = searchParams.mid;
  return (
    <DetailPane
      oppId={params.id}
      title={mid ? "商談メモ" : "案件詳細"}
      fullHref={mid ? `/app/opportunities/${params.id}/meetings/${mid}` : `/app/opportunities/${params.id}`}
    >
      {mid ? (
        <MeetingDetailView oppId={params.id} mid={mid} inPane saved={searchParams.saved} />
      ) : (
        <OpportunityDetailView id={params.id} inPane saved={searchParams.saved} error={searchParams.error} />
      )}
    </DetailPane>
  );
}
