import { Telescope } from "lucide-react";
import { Card, EmptyState, LinkButton, Section } from "@/components/ui/primitives";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PMO_MODE_MAP } from "@/lib/pmo";
import { formatDateTimeJst } from "@/lib/utils";

/** Markdownの記号を落として先頭の要約テキストを作る(ガジェットの抜粋表示用)。 */
function mdExcerpt(md: string, len = 200): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > len ? plain.slice(0, len) + "…" : plain;
}

/** AI-PMOガジェット: 最新レポートのサマリーを表示。 */
export async function PmoGadget() {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("pmo_reports")
    .select("id,mode,title,report_md,created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const report = data as { id: string; mode: string; title: string | null; report_md: string; created_at: string } | null;
  const mode = report ? PMO_MODE_MAP[report.mode] : null;

  return (
    <Section
      title="AI-PMO"
      icon={<Telescope size={16} />}
      action={<LinkButton href="/app/pmo" variant="ghost">AI-PMOへ</LinkButton>}
    >
      <Card className="p-4">
        {!report ? (
          <EmptyState message="AI-PMOレポートはまだありません" />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg shrink-0">{mode?.emoji ?? "📋"}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700 truncate">{report.title ?? mode?.label ?? "レポート"}</div>
                <div className="text-[11px] text-slate-400">{mode?.label ?? report.mode} ・ {formatDateTimeJst(report.created_at)}</div>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 line-clamp-4">{mdExcerpt(report.report_md)}</p>
          </div>
        )}
      </Card>
    </Section>
  );
}
