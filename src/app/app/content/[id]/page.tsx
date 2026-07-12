import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Palette, PenLine } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { getContentIdea, type DesignStatus } from "@/lib/data/content-ideas";
import { setDesignStatusAction, saveContentBodyAction } from "@/server/actions/content-ideas";
import { CopyArea } from "@/components/marketing/copy-area";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DESIGN_META: Record<DesignStatus, { label: string; cls: string; desc: string }> = {
  none: { label: "未", cls: "bg-mist-soft text-ink/50 border border-black/5", desc: "デザイン工程はまだ" },
  ready: { label: "連携待ち", cls: "bg-amber-50 text-accent-orange border border-accent-orange/20", desc: "Claudeデザインへ渡す準備ができた" },
  linked: { label: "デザイン連携済", cls: "bg-teal-primary text-white", desc: "Claudeデザインに取り込み済み" },
  manual: { label: "手動コピペ", cls: "bg-emerald-100 text-emerald-700", desc: "連携せず手動でデザイン作成" },
};

/** B8 記事詳細: 本文の閲覧・コピー、Claudeデザイン連携フラグ、手動編集。 */
export default async function ContentDetailPage({ params }: { params: { id: string } }) {
  await requireCtx();
  const item = await getContentIdea(params.id);
  if (!item) notFound();

  return (
    <div>
      <PageHeader
        title={item.title}
        subtitle={[item.theme, item.target_keyword && `🔎 ${item.target_keyword}`, formatDate(item.created_at)]
          .filter(Boolean)
          .join(" ・ ")}
        action={
          <Link href="/app/content" className="btn-ghost inline-flex items-center gap-1 text-sm">
            <ArrowLeft size={14} /> 一覧へ
          </Link>
        }
      />

      {item.angle && <p className="mb-4 text-sm text-ink/60">狙い: {item.angle}</p>}

      {/* デザイン連携フラグ */}
      <Section title="デザイン連携" icon={<Palette size={15} className="text-teal-primary" />} className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(DESIGN_META) as DesignStatus[]).map((s) => {
            const meta = DESIGN_META[s];
            const active = item.design_status === s;
            return (
              <form key={s} action={setDesignStatusAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="design_status" value={s} />
                <button
                  type="submit"
                  title={meta.desc}
                  className={cn("pill transition-all", meta.cls, active ? "ring-2 ring-teal-primary/60 ring-offset-1" : "opacity-60 hover:opacity-100")}
                >
                  {meta.label}
                </button>
              </form>
            );
          })}
          <span className="text-xs text-ink/45 ml-1">{DESIGN_META[item.design_status].desc}</span>
        </div>
        <p className="mt-2 text-xs text-ink/45">
          「連携待ち」にすると、Claudeデザインへの取り込み対象として一覧で拾えます。連携できない場合は下の本文を「全文コピー」して手動で貼り付け、「手動コピペ」にしてください。
        </p>
      </Section>

      {/* 本文 */}
      <Section title="記事本文（Markdown）" icon={<PenLine size={15} className="text-teal-primary" />} className="mb-6">
        {item.body_md?.trim() ? (
          <CopyArea text={item.body_md} />
        ) : (
          <EmptyState message="本文はまだありません。夜間バッチ（記事ドラフト生成）が「選定」状態のネタから執筆するか、下の編集欄に手動で書けます。" />
        )}
      </Section>

      {/* 手動編集 */}
      <details className="card card-pad">
        <summary className="cursor-pointer text-sm font-semibold text-teal-deep">本文を編集する（手動）</summary>
        <form action={saveContentBodyAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={item.id} />
          <textarea
            name="body_md"
            rows={18}
            defaultValue={item.body_md ?? ""}
            placeholder="# 見出し&#10;&#10;本文をMarkdownで…"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm font-mono leading-relaxed focus:border-teal-primary focus:outline-none"
          />
          <div className="flex justify-end">
            <SubmitButton className="btn-primary" pendingLabel="保存中…">本文を保存</SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}
