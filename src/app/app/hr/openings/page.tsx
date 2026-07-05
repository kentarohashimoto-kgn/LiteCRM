import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createJobOpeningAction, updateJobOpeningAction } from "@/server/actions/hr";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { client: "クライアント案件", internal: "カトルセ人員" };
const STATUSES = [
  { key: "open", label: "募集中" },
  { key: "interviewing", label: "選考中" },
  { key: "filled", label: "充足" },
  { key: "closed", label: "クローズ" },
];

interface Opening {
  id: string; kind: string; title: string; client_name: string | null;
  role_description: string | null; status: string; rate_note: string | null; opened_at: string;
}

/** BO-5 求人案件: クライアント案件(SES/講師派遣等)とカトルセ社内採用の募集を一元管理。 */
export default async function OpeningsPage() {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [openingsR, candR] = await Promise.all([
    sb.from("job_openings").select("id, kind, title, client_name, role_description, status, rate_note, opened_at").order("created_at", { ascending: false }).limit(200),
    sb.from("candidates").select("job_opening_id").not("job_opening_id", "is", null),
  ]);
  const openings = (openingsR.data ?? []) as Opening[];
  const candCount = new Map<string, number>();
  for (const c of candR.data ?? []) {
    const k = c.job_opening_id as string;
    candCount.set(k, (candCount.get(k) ?? 0) + 1);
  }
  const active = openings.filter((o) => o.status === "open" || o.status === "interviewing");

  return (
    <div className="max-w-4xl">
      <PageHeader title="求人案件" subtitle="クライアント案件とカトルセ人員の募集をまとめて管理します。候補者は候補者ページから紐付けます。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">募集中・選考中</div><div className="stat-value mt-1">{active.length}</div></Card>
        <Card><div className="text-xs text-ink/50">クライアント案件</div><div className="stat-value mt-1">{active.filter((o) => o.kind === "client").length}</div></Card>
        <Card><div className="text-xs text-ink/50">カトルセ人員</div><div className="stat-value mt-1">{active.filter((o) => o.kind === "internal").length}</div></Card>
      </div>

      <Section title="求人案件を追加" className="mb-5">
        <form action={createJobOpeningAction} className="flex items-end gap-2.5 flex-wrap">
          <div>
            <label className="label">区分 *</label>
            <select name="kind" className="input w-auto" defaultValue="internal">
              <option value="internal">カトルセ人員</option>
              <option value="client">クライアント案件</option>
            </select>
          </div>
          <div><label className="label">ポジション名 *</label><input name="title" required className="input" placeholder="例: AI講師 / 開発エンジニア" /></div>
          <div><label className="label">クライアント名</label><input name="client_name" className="input" placeholder="クライアント案件の場合" /></div>
          <div><label className="label">単価・条件メモ</label><input name="rate_note" className="input" /></div>
          <div className="w-full"><label className="label">募集要件</label><input name="role_description" className="input" placeholder="必要スキル・経験など" /></div>
          <button type="submit" className="btn-accent">追加</button>
        </form>
      </Section>

      <Section title={`求人一覧（${openings.length}）`}>
        {openings.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">求人案件がまだありません</p>
        ) : (
          <ul className="space-y-2">
            {openings.map((o) => (
              <li key={o.id} className="rounded-xl border border-black/[0.05] p-3">
                <div className="flex items-center gap-2.5 flex-wrap text-sm">
                  <span className={`pill ${o.kind === "client" ? "bg-indigo-50 text-indigo-700" : "bg-teal-light text-teal-deep"}`}>{KIND_LABEL[o.kind] ?? o.kind}</span>
                  <span className="font-medium">{o.title}</span>
                  {o.client_name && <span className="text-xs text-ink/45">{o.client_name}</span>}
                  <span className="text-xs text-ink/40">候補者 {candCount.get(o.id) ?? 0}名</span>
                  <span className="text-xs text-ink/40 tabular-nums ml-auto">{o.opened_at}〜</span>
                  <form action={updateJobOpeningAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={o.id} />
                    {STATUSES.map((s) => (
                      <button
                        key={s.key}
                        name="op"
                        value={s.key}
                        className={`rounded-lg px-2 py-1 text-xs border ${o.status === s.key ? "bg-teal-deep text-white border-teal-deep" : "border-black/10 hover:bg-black/[0.03]"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                    <button name="op" value="delete" className="text-xs text-rose-500 hover:underline ml-1">削除</button>
                  </form>
                </div>
                {(o.role_description || o.rate_note) && (
                  <p className="text-xs text-ink/55 mt-1.5">
                    {o.role_description}
                    {o.rate_note && <span className="text-ink/40">（{o.rate_note}）</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
