import { SlidesScreen } from "@/components/ai-lab/slides/slides-screen";

// 受講者ごとに内容が変わるため、常にリクエスト時に描画する。
export const dynamic = "force-dynamic";

export default function LabSlidesPage({ params }: { params: { slug: string } }) {
  return <SlidesScreen slug={params.slug} />;
}
