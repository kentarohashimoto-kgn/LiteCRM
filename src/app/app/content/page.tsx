import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { listContentIdeas, contentStatusCounts } from "@/lib/data/content-ideas";
import { ContentView } from "@/components/marketing/content-view";

export const dynamic = "force-dynamic";

/**
 * B8 マーケ: 記事ネタ・ブログパイプライン。
 * ネタ→選定→執筆中→公開 の状態で記事候補を管理する。将来、営業ニーズ＋Web検索から
 * 夜間バッチで候補を自動生成しここに積む(現状は手動運用の受け皿)。
 */
export default async function ContentPage(
  props: {
    searchParams: Promise<{ status?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const status = searchParams.status ?? "";
  const [items, counts] = await Promise.all([listContentIdeas(status), contentStatusCounts()]);

  return (
    <div>
      <PageHeader
        title="記事ネタ・ブログ"
        subtitle="SEOブログのネタ→タイトル案→ドラフト→公開をパイプラインで管理します。営業の学び(ノウハウ)を集客に還元する入口。"
      />
      <ContentView items={items} counts={counts} status={status} />
    </div>
  );
}
