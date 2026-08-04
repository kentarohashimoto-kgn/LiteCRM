import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getMindmap } from "@/lib/data/mindmaps";
import { MindmapCanvas } from "@/components/mindmap/mindmap-canvas";
import { MindmapTitle } from "@/components/mindmap/mindmap-title";

export const dynamic = "force-dynamic";

/** マインドマップ編集画面(管理者専用)。 */
export default async function MindmapEditorPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireAdminCtx();
  const map = await getMindmap(params.id);
  if (!map) notFound();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/app/mindmaps" className="text-xs font-semibold text-ink/50 hover:text-teal-primary inline-flex items-center gap-1">
          <ChevronLeft size={14} /> マインドマップ一覧
        </Link>
        <MindmapTitle mindmapId={map.meta.id} initialTitle={map.meta.title} />
        {map.meta.note && <span className="text-[11px] text-ink/40">{map.meta.note}</span>}
      </div>
      <MindmapCanvas meta={map.meta} initialNodes={map.nodes} initialLinks={map.links} />
    </div>
  );
}
