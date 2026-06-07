import { getWorkspace } from "@/lib/data/workspace";
import { getLeadSources, getProducts, listMembers } from "@/lib/data/select";
import { PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { ROLES, ROLE_MAP, STAGES, FORECAST_CATEGORIES } from "@/lib/constants";
import { createMemberAction } from "@/server/actions";
import { formatYen, formatPercent } from "@/lib/utils";

export default async function SettingsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const ws = await getWorkspace();
  const members = listMembers(ws);
  const products = getProducts(ws);
  const sources = getLeadSources(ws);
  const isAdmin = ["owner", "admin"].includes(ws.ctx.role);

  return (
    <div>
      <PageHeader title="設定" subtitle="メンバー・商材・流入経路・ステージはテナント設定として管理します。" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="メンバー / ロール">
          <ul className="divide-y divide-black/[0.04]">
            {members.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2.5">
                <Avatar user={m.user} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.user.name}</div>
                  <div className="text-xs text-ink/45">{m.user.email}</div>
                </div>
                <Tag tone="teal">{ROLE_MAP[m.role]?.label ?? m.role}</Tag>
              </li>
            ))}
          </ul>
        </Section>

        {isAdmin ? (
          <Section title="メンバーを発行(管理者)">
            {searchParams.ok && <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">{searchParams.ok}</p>}
            {searchParams.error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3">{searchParams.error}</p>}
            <form action={createMemberAction} className="space-y-3">
              <div><label className="label">氏名</label><input name="display_name" className="input" placeholder="山田 太郎" /></div>
              <div><label className="label">メールアドレス *</label><input name="email" type="email" required className="input" placeholder="user@catorce.jp" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">初期パスワード *</label><input name="password" required className="input" placeholder="8文字以上" /></div>
                <div><label className="label">ロール</label>
                  <select name="role" defaultValue="sales_rep" className="input">
                    {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" className="btn-primary w-full">発行する</button>
              <p className="text-[11px] text-ink/40">発行後、本人がメールと初期パスワードでログインできます。パスワードは各自で変更を推奨します。</p>
            </form>
          </Section>
        ) : (
          <Section title="ロール定義(権限)">
            <ul className="space-y-2">
              {ROLES.map((r) => (
                <li key={r.key} className="flex items-start gap-2 text-sm">
                  <Tag tone="gray">{r.label}</Tag>
                  <span className="text-xs text-ink/55 mt-1">{r.description}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="商材マスタ" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th">商品名</th>
                  <th className="th">カテゴリ</th>
                  <th className="th">課金</th>
                  <th className="th text-right">標準価格</th>
                  <th className="th text-right">標準粗利率</th>
                  <th className="th">備考</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {products.map((p) => (
                  <tr key={p.id} className="row-hover">
                    <td className="td font-medium">{p.name}</td>
                    <td className="td"><Tag tone="gray">{p.category}</Tag></td>
                    <td className="td text-xs">{p.is_recurring ? "継続" : "都度"}</td>
                    <td className="td text-right tabular-nums">{formatYen(p.default_price)}</td>
                    <td className="td text-right tabular-nums">{formatPercent(p.default_gross_profit_rate)}</td>
                    <td className="td text-xs text-ink/50">{p.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="商談ステージ">
          <ul className="space-y-1.5">
            {STAGES.map((s) => (
              <li key={s.key} className="flex items-center justify-between text-sm">
                <span>{s.label}</span>
                <span className="text-xs tabular-nums text-ink/50">基準確度 {s.probability}%</span>
              </li>
            ))}
          </ul>
        </Section>

        <div className="space-y-5">
          <Section title="ヨミ区分">
            <ul className="space-y-1.5">
              {FORECAST_CATEGORIES.map((f) => (
                <li key={f.key} className="text-sm">
                  <span className="font-medium">{f.label}</span>
                  <span className="text-xs text-ink/50 ml-2">{f.description}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="流入経路マスタ">
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => <Tag key={s.id} tone="teal">{s.name}</Tag>)}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
