import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail-view";

/**
 * 案件詳細フルページ。直リンク/リロード・他画面からの遷移で表示される。
 * 案件一覧からのクリックは並列ルートのスライドオーバー（@detail/(.)[id]）が横取りする。
 */
export default async function OpportunityDetailPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ error?: string; saved?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return <OpportunityDetailView id={params.id} saved={searchParams.saved} error={searchParams.error} />;
}
