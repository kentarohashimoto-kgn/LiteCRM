import { SlidesScreen } from "@/components/ai-lab/slides/slides-screen";

export const dynamic = "force-dynamic";

export default async function LabDeckPage(props: { params: Promise<{ slug: string; deckId: string }> }) {
  const params = await props.params;
  return <SlidesScreen slug={params.slug} deckId={params.deckId} />;
}
