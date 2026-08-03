import { SlidesScreen } from "@/components/ai-lab/slides/slides-screen";

export const dynamic = "force-dynamic";

export default function LabDeckPage({ params }: { params: { slug: string; deckId: string } }) {
  return <SlidesScreen slug={params.slug} deckId={params.deckId} />;
}
