import Link from "next/link";
import { GitMerge, Trash2 } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { ROLES, ROLE_MAP, STAGES, YOMI_OPTIONS, FORECAST_CATEGORIES, DEAL_PHASES } from "@/lib/constants";
import { createMemberAction } from "@/server/actions";
import { addLeadSourceDetailAction, deleteLeadSourceDetailAction } from "@/server/actions/masters";
import { MemberManager } from "@/components/settings/member-manager";
import { ProductMaster, type ProductRow } from "@/components/settings/product-master";
import { NameMaster } from "@/components/settings/name-master";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const ws = await getWorkspaceLite();
  const isAdmin = ["owner", "admin"].includes(ws.ctx.role);

  const members = ws.memberships.map((m) => {
    const u = ws.usersById.get(m.user_id);
    return { userId: m.user_id, name: u?.name ?? "—", email: u?.email ?? "", role: m.role as string, memo: (m as { memo?: string }).memo ?? null };
  });
  const products: ProductRow[] = ws.products.map((p) => {
    const x = p as unknown as Record<string, unknown>;
    return {
      id: p.id, name: p.name,
      category: (x.category as string) ?? null,
      product_type: (x.product_type as string) ?? null,
      default_price: (x.default_price as number) ?? null,
      unit_cost: (x.unit_cost as number) ?? null,
      priority_flag: Boolean(x.priority_flag),
      status: (x.status as string) ?? "active",
    };
  });
  const sources = ws.leadSources.map((s) => ({ id: s.id, name: s.name, sub: (s as { description?: string }).description ?? null }));
  const campaigns = ws.campaigns.map((c) => ({ id: c.id, name: c.name, sub: (c as { channel?: string }).channel ?? null }));
  const sb = getSupabaseServer();
  const [{ data: bookingRows }, { data: detailRows }] = await Promise.all([
    sb.from("booking_links").select("id,label,url,sort_order").order("sort_order"),
    sb.from("lead_source_details").select("id, lead_source_id, name").eq("status", "active").order("name"),
  ]);
  const bookings = (bookingRows ?? []).map((b) => ({ id: b.id as string, name: b.label as string, sub: (b.url as string) ?? null }));
  const sourceDetails = (detailRows ?? []) as { id: string; lead_source_id: string; name: string }[];

  return (
    <div>
      <PageHeader
        title="設定"
        subtitle="メンバー・商材・流入経路・展示会/施策をマスタとして管理します。ステージ・ヨミはシステム定義（下部参照）。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/settings/duplicates" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
              <GitMerge size={15} /> 重複マージ
            </Link>
            <Link href="/app/settings/trash" className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]">
              <Trash2 size={15} /> ゴミ箱
            </Link>
          </div>
        }
      />

      {/* メンバー管理 */}
      <Section title="メンバー / ロール" className="mb-5">
        {isAdmin ? (
          <MemberManager members={members} roles={ROLES.map((r) => ({ key: r.key, label: r.label }))} currentUserId={ws.ctx.userId} />
        ) : (
          <ul className="divide-y divide-black/[0.04]">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                <Avatar user={ws.usersById.get(m.userId)} size={28} />
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{m.name}</div><div className="text-xs text-ink/45">{m.email}</div></div>
                <Tag tone="teal">{ROLE_MAP[m.role]?.label ?? m.role}</Tag>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isAdmin && (
        <Section title="メンバーを発行(管理者)" className="mb-5">
          {searchParams.ok && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">{searchParams.ok}</p>}
          {searchParams.error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3">{searchParams.error}</p>}
          <form action={createMemberAction} className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
            <div><label className="label">氏名</label><input name="display_name" className="input" placeholder="山田 太郎" /></div>
            <div><label className="label">メールアドレス *</label><input name="email" type="email" required className="input" placeholder="user@catorce.jp" /></div>
            <div><label className="label">初期パスワード *</label><input name="password" required className="input" placeholder="8文字以上" /></div>
            <div><label className="label">ロール</label>
              <select name="role" defaultValue="sales_rep" className="input">{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
            </div>
            <div className="md:col-span-2"><label className="label">メモ</label><input name="memo" className="input" placeholder="担当領域・入社日など" /></div>
            <div className="md:col-span-2"><SubmitButton className="btn-primary" pendingLabel="発行中…">発行する</SubmitButton></div>
          </form>
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 商材マスタ */}
        <Section title="商材マスタ" className="lg:col-span-2">
          <ProductMaster products={products} />
        </Section>

        <Section title="流入経路マスタ">
          <NameMaster kind="lead_source" rows={sources} subLabel="説明" />
        </Section>

        <Section title="展示会・施策マスタ">
          <NameMaster kind="campaign" rows={campaigns} subLabel="チャネル" />
        </Section>

        {/* 流入詳細マスタ: 経路ごとの選択肢(各展示会・各パートナー等) */}
        <Section title="流入詳細マスタ（経路ごとの選択肢）" className="lg:col-span-2">
          <p className="text-xs text-ink/50 mb-3">
            流入経路を選んだときに出る「流入詳細」の選択肢です（展示会→各展示会、パートナー→各パートナー など）。
            案件の作成・編集で直接入力された新しい値も、自動でここに追加されます。
          </p>
          <form action={addLeadSourceDetailAction} className="flex items-end gap-2.5 flex-wrap mb-4">
            <div>
              <label className="label">流入経路</label>
              <select name="lead_source_id" required className="input w-auto">
                <option value="">選択してください</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="min-w-[220px]"><label className="label">詳細の名称</label><input name="name" required className="input" placeholder="例: 202609_AIWorld / 株式会社○○(パートナー名)" /></div>
            <SubmitButton className="btn-accent" pendingLabel="追加中…">追加</SubmitButton>
          </form>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sources
              .filter((s) => sourceDetails.some((d) => d.lead_source_id === s.id))
              .map((s) => (
                <div key={s.id} className="rounded-xl border border-black/[0.05] p-3">
                  <div className="text-xs font-bold text-ink/60 mb-2">{s.name}（{sourceDetails.filter((d) => d.lead_source_id === s.id).length}）</div>
                  <ul className="space-y-1 max-h-48 overflow-y-auto">
                    {sourceDetails.filter((d) => d.lead_source_id === s.id).map((d) => (
                      <li key={d.id} className="flex items-center gap-2 text-sm">
                        <span className="truncate">{d.name}</span>
                        <form action={deleteLeadSourceDetailAction} className="ml-auto shrink-0">
                          <input type="hidden" name="id" value={d.id} />
                          <SubmitButton className="text-xs text-rose-500 hover:underline" pendingLabel="保存中…">削除</SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </Section>

        <Section title="各担当の予約URL（カレンダー下部に表示）" className="lg:col-span-2">
          <NameMaster kind="booking" rows={bookings} subLabel="予約URL" />
        </Section>
      </div>

      {/* システム定義(コード紐付き・参照) */}
      <Section title="システム定義値（参照）" className="mt-5">
        <p className="text-xs text-ink/50 mb-3">案件ステージ・ヨミ・予測区分・案件予測は、確度計算やステージ変換などの業務ロジックに紐づくシステム定義値です。追加・改廃はロジック変更を伴うため、変更が必要な場合はご相談ください。</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs font-bold text-ink/50 mb-1.5">案件ステージ</div>
            <ul className="space-y-1">{STAGES.map((s) => <li key={s.key} className="flex justify-between"><span>{s.label}</span><span className="text-xs text-ink/40 tabular-nums">{s.probability}%</span></li>)}</ul>
          </div>
          <div>
            <div className="text-xs font-bold text-ink/50 mb-1.5">ヨミ区分</div>
            <ul className="space-y-1">{YOMI_OPTIONS.map((y) => <li key={y.key}>{y.label}</li>)}</ul>
          </div>
          <div>
            <div className="text-xs font-bold text-ink/50 mb-1.5">予測区分</div>
            <ul className="space-y-1">{FORECAST_CATEGORIES.map((f) => <li key={f.key}>{f.label}</li>)}</ul>
          </div>
          <div>
            <div className="text-xs font-bold text-ink/50 mb-1.5">案件予測</div>
            <ul className="space-y-1">{DEAL_PHASES.map((d) => <li key={d.key}>{d.label}</li>)}</ul>
          </div>
        </div>
      </Section>
    </div>
  );
}
