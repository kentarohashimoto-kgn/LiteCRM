import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { updateExpoTemplateAction } from "@/server/actions/bo";

export const dynamic = "force-dynamic";

const CATEGORIES = ["出展手続", "人員", "制作物", "物流", "当日運営", "その他"];

/** 展示会タスクプリセット: 確定時に自動生成されるWBSの雛形。 */
export default async function ExpoTemplatesPage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("expo_task_templates")
    .select("id, name, category, offset_days, sort_order")
    .eq("active", true)
    .order("sort_order");
  const templates = (data ?? []) as { id: string; name: string; category: string; offset_days: number; sort_order: number }[];

  return (
    <div className="max-w-3xl">
      <Link href="/app/bo/expos" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 展示会一覧
      </Link>
      <PageHeader title="タスクプリセット" subtitle="展示会を「確定」にすると、ここのタスクが会期基準の期日つきで自動生成されます。" />

      <Section title={`プリセット（${templates.length}）`}>
        <ul className="divide-y divide-black/[0.04] mb-4">
          {templates.map((t) => (
            <li key={t.id} className="py-2 flex items-center gap-2.5 text-sm">
              <span className="pill bg-black/[0.04] text-ink/50 shrink-0">{t.category}</span>
              <span className="text-ink/80 min-w-0 flex-1 truncate">{t.name}</span>
              <span className="text-xs text-ink/45 tabular-nums shrink-0">
                {t.offset_days === 0 ? "会期初日" : t.offset_days < 0 ? `${-t.offset_days}日前` : `${t.offset_days}日後`}
              </span>
              <form action={updateExpoTemplateAction} className="shrink-0">
                <input type="hidden" name="id" value={t.id} />
                <button name="op" value="delete" className="text-ink/25 hover:text-rose-500 text-xs">削除</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={updateExpoTemplateAction} className="flex items-end gap-2 flex-wrap border-t border-black/[0.04] pt-3">
          <input type="hidden" name="op" value="add" />
          <input name="name" required className="input max-w-xs" placeholder="タスク名" />
          <select name="category" className="input w-auto">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <div>
            <label className="label">会期初日の何日前？</label>
            <input name="offset_days_before" type="number" min={0} defaultValue={30} className="input w-24" aria-label="日数(前)" />
          </div>
          <button type="submit" className="btn-accent">追加</button>
        </form>
      </Section>
    </div>
  );
}
