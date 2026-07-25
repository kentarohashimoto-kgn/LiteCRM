import Link from "next/link";
import { Brain, CalendarRange, Presentation, Plus, Copy, Trash2 } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { listMindmaps } from "@/lib/data/mindmaps";
import { mondayJst } from "@/lib/data/weekly-snapshot";
import { addDays } from "@/lib/mindmap-weekly";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  createMindmapAction,
  deleteMindmapAction,
  duplicateMindmapAction,
  generateWeeklyMindmapAction,
} from "@/server/actions/mindmaps";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  weekly_plan: "週次予定",
  seminar: "研修・セミナー",
  freeform: "自由",
};

/**
 * マインドマップ一覧(管理者専用)。
 * ・今週/来週の予定マップを自動生成(Googleカレンダー × CRM × 週次報告)
 * ・研修・セミナー構成テンプレート / 自由マップの作成
 */
export default async function MindmapsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireAdminCtx();
  const maps = await listMindmaps();
  const thisWeek = mondayJst(new Date());
  const nextWeek = addDays(thisWeek, 7);
  const weekLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}週`;

  return (
    <div>
      <PageHeader
        title="マインドマップ"
        subtitle="予定と段取りを1枚に。カレンダー・案件・ヨミを取り込んで、抜けている準備を洗い出します。"
      />

      {searchParams.error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">{searchParams.error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 mb-5">
        <Section title="週次予定を自動生成" icon={<CalendarRange size={15} />} className="lg:col-span-2">
          <p className="text-xs text-ink/50 mb-3">
            Googleカレンダーの予定・CRMのアポ/商談・今月と来月のクロージング予定(売上ヨミ)・期日タスク・週次報告を
            取り込み、1日ごとの枝と「事前準備」の枝を作ります。生成後は自由に編集できます。
          </p>
          <form action={generateWeeklyMindmapAction} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="week">
                対象週
              </label>
              <select id="week" name="week" className="input !w-auto" defaultValue="this">
                <option value="this">今週（{weekLabel(thisWeek)}）</option>
                <option value="next">来週（{weekLabel(nextWeek)}）</option>
                <option value="prev">先週（{weekLabel(addDays(thisWeek, -7))}）</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-ink/70 pb-2.5">
              <input type="checkbox" name="use_ai" value="1" className="h-4 w-4 rounded border-black/20" />
              AIで段取り提案を追加
            </label>
            <SubmitButton className="btn-primary mb-0.5" pendingLabel="生成中…">
              <Plus size={15} /> 生成する
            </SubmitButton>
          </form>
        </Section>

        <Section title="新しいマップ" icon={<Brain size={15} />}>
          <form action={createMindmapAction} className="space-y-2">
            <div>
              <label className="label" htmlFor="title">
                タイトル
              </label>
              <input id="title" name="title" className="input" placeholder="例: AI活用研修 構成案" required />
            </div>
            <div>
              <label className="label" htmlFor="kind">
                種類
              </label>
              <select id="kind" name="kind" className="input" defaultValue="seminar">
                <option value="seminar">研修・セミナー構成（テンプレート付き）</option>
                <option value="freeform">自由（白紙）</option>
              </select>
            </div>
            <SubmitButton className="btn-ghost w-full" pendingLabel="作成中…">
              <Plus size={15} /> 作成
            </SubmitButton>
          </form>
        </Section>
      </div>

      <Section title={`マップ一覧（${maps.length}件）`} icon={<Presentation size={15} />}>
        {maps.length === 0 ? (
          <EmptyState message="まだマップがありません。上の「生成する」から今週の予定マップを作ってみてください。" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {maps.map((m) => (
              <div key={m.id} className="rounded-xl border border-black/[0.06] p-4 hover:border-teal-primary/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/app/mindmaps/${m.id}`} className="min-w-0 font-bold text-ink hover:text-teal-primary">
                    {m.title}
                  </Link>
                  <span className="pill bg-teal-light text-teal-deep shrink-0">{KIND_LABEL[m.kind] ?? m.kind}</span>
                </div>
                <div className="mt-1 text-xs text-ink/50">
                  {m.nodeCount}ノード / 更新 {formatDateTimeJst(m.updated_at)}
                  {m.source === "auto" && <span className="ml-1 text-accent-orange font-semibold">自動生成</span>}
                </div>
                {m.note && <p className="mt-1 line-clamp-2 text-[11px] text-ink/40">{m.note}</p>}
                <div className="mt-3 flex items-center gap-1.5">
                  <Link href={`/app/mindmaps/${m.id}`} className="btn-primary !py-1.5 !px-3 text-xs">
                    開く
                  </Link>
                  <Link href={`/app/mindmaps/${m.id}/present`} className="btn-ghost !py-1.5 !px-3 text-xs">
                    プレゼン
                  </Link>
                  <form action={duplicateMindmapAction} className="ml-auto">
                    <input type="hidden" name="id" value={m.id} />
                    <SubmitButton className="btn-ghost !py-1.5 !px-2" pendingLabel="…" title="複製">
                      <Copy size={13} />
                    </SubmitButton>
                  </form>
                  <form action={deleteMindmapAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <SubmitButton className="btn-ghost !py-1.5 !px-2 text-red-600" pendingLabel="…" title="削除">
                      <Trash2 size={13} />
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
