import { notFound } from "next/navigation";
import { requireAdminCtx } from "@/lib/session";
import { getMindmap } from "@/lib/data/mindmaps";
import { PresentView } from "@/components/mindmap/present-view";

export const dynamic = "force-dynamic";

/** プレゼンモード(全画面): マインドマップの枝を1つずつ辿って発表する。 */
export default async function MindmapPresentPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireAdminCtx();
  const map = await getMindmap(params.id);
  if (!map) notFound();

  return <PresentView meta={map.meta} nodes={map.nodes} />;
}
