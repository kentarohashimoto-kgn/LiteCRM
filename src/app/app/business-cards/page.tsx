import Link from "next/link";
import { Contact, Upload } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, LinkButton, Card } from "@/components/ui/primitives";
import { queryBusinessCards, getCardStats, type CardListFilters } from "@/lib/data/business-cards";
import { MatchRunButton } from "@/components/business-cards/match-run-button";
import { CardLinkCell } from "@/components/business-cards/card-link-cell";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * 名刺情報一覧（組織共有）。
 * 個人が交換した名刺をテナント全員で閲覧・検索し、CRM顧客との連携状態を確認できる。
 */
export default async function BusinessCardsPage({
  searchParams,
}: {
  searchParams: { q?: string; link?: string; page?: string };
}) {
  await requireCtx();
  const filters: CardListFilters = {
    q: searchParams.q ?? "",
    link: searchParams.link === "linked" || searchParams.link === "unlinked" ? searchParams.link : "all",
    page: searchParams.page ? Math.max(1, parseInt(searchParams.page, 10) || 1) : 1,
    pageSize: PAGE_SIZE,
  };
  const sb = getSupabaseServer();
  const [{ rows, total }, stats, profilesR] = await Promise.all([
    queryBusinessCards(filters),
    getCardStats(),
    sb.from("profiles").select("id, display_name"),
  ]);
  const nameById = new Map((profilesR.data ?? []).map((p) => [p.id, p.display_name as string]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.link !== "all") p.set("link", filters.link);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div>
      <PageHeader
        title="名刺情報"
        subtitle="メンバーが名刺交換したデータを組織で共有します。会社名・氏名・メールでCRM顧客と自動マッチングできます。"
        action={
          <div className="flex items-center gap-2">
            <MatchRunButton />
            <LinkButton href="/app/business-cards/import" variant="accent">
              <Upload size={15} className="mr-1 inline" />
              名刺を取込
            </LinkButton>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card>
          <div className="text-xs text-ink/50">名刺総数</div>
          <div className="stat-value mt-1">{stats.total.toLocaleString()}<span className="stat-unit">枚</span></div>
        </Card>
        <Card>
          <div className="text-xs text-ink/50">CRM顧客と連携済み</div>
          <div className="stat-value mt-1 stat-accent">{stats.linked.toLocaleString()}<span className="stat-unit">枚</span></div>
          <div className="text-xs text-ink/40 mt-1">うち担当者まで一致 {stats.contactLinked.toLocaleString()}枚</div>
        </Card>
        <Card>
          <div className="text-xs text-ink/50">未連携</div>
          <div className="stat-value mt-1">{(stats.total - stats.linked).toLocaleString()}<span className="stat-unit">枚</span></div>
        </Card>
      </div>

      {/* 検索・絞り込み（GETフォーム） */}
      <form method="GET" className="card card-pad mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="会社名・氏名・部署・役職・メール・メモで検索"
          className="flex-1 min-w-60 rounded-xl border border-black/10 px-3 py-2 text-sm"
        />
        <select name="link" defaultValue={filters.link} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
          <option value="all">すべて</option>
          <option value="linked">連携済みのみ</option>
          <option value="unlinked">未連携のみ</option>
        </select>
        <button type="submit" className="btn-primary">検索</button>
        {(filters.q || filters.link !== "all") && (
          <Link href="/app/business-cards" className="text-sm text-ink/50 hover:text-ink">クリア</Link>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">交換日</th>
              <th className="th">会社名</th>
              <th className="th">氏名</th>
              <th className="th">部署 / 役職</th>
              <th className="th">連絡先</th>
              <th className="th">タグ</th>
              <th className="th">交換者</th>
              <th className="th">CRM連携</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((c) => (
              <tr key={c.id} className="row-hover align-top">
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.exchanged_on ?? "—"}</td>
                <td className="td font-medium max-w-56">
                  <div className="truncate" title={c.company_name}>{c.company_name || "—"}</div>
                </td>
                <td className="td whitespace-nowrap">
                  {c.full_name || "—"}
                  {c.rank && <span className="ml-1.5 pill text-[10px]">{c.rank}</span>}
                </td>
                <td className="td text-xs text-ink/60 max-w-56">
                  <div className="truncate" title={`${c.department ?? ""} ${c.title ?? ""}`}>
                    {[c.department, c.title].filter(Boolean).join(" / ") || "—"}
                  </div>
                </td>
                <td className="td text-xs text-ink/60">
                  <div>{c.email ?? "—"}</div>
                  <div>{c.mobile_phone ?? c.tel_company ?? ""}</div>
                </td>
                <td className="td max-w-44">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 2).map((t) => (
                      <span key={t} className="pill text-[10px]" title={t}>{t.length > 14 ? t.slice(0, 14) + "…" : t}</span>
                    ))}
                    {c.tags.length > 2 && <span className="text-[10px] text-ink/40">+{c.tags.length - 2}</span>}
                  </div>
                </td>
                <td className="td text-xs whitespace-nowrap">{nameById.get(c.owner_user_id) ?? "—"}</td>
                <td className="td">
                  <CardLinkCell
                    cardId={c.id}
                    accountId={c.account_id ?? null}
                    accountName={c.accounts?.name ?? null}
                    contactName={c.contacts?.name ?? null}
                    matchType={c.match_type ?? null}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="td text-center text-ink/40 py-10">
                  {stats.total === 0 ? (
                    <span>
                      名刺がありません。<Link href="/app/business-cards/import" className="text-teal-deep hover:underline">Eightのエクスポート（CSV）を取込</Link>んでください。
                    </span>
                  ) : (
                    "条件に一致する名刺がありません"
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ページング */}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="text-ink/50">
            {total.toLocaleString()}件中 {((filters.page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(filters.page * PAGE_SIZE, total).toLocaleString()}件
          </div>
          <div className="flex items-center gap-2">
            {filters.page > 1 ? (
              <Link href={`/app/business-cards${qs(filters.page - 1)}`} className="btn-ghost">← 前へ</Link>
            ) : (
              <span className="btn-ghost opacity-40 pointer-events-none">← 前へ</span>
            )}
            <span className="text-ink/50">{filters.page} / {pages}</span>
            {filters.page < pages ? (
              <Link href={`/app/business-cards${qs(filters.page + 1)}`} className="btn-ghost">次へ →</Link>
            ) : (
              <span className="btn-ghost opacity-40 pointer-events-none">次へ →</span>
            )}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-ink/40 flex items-center gap-1.5">
        <Contact size={13} />
        マッチング優先順: ①メール一致（担当者＋顧客） ②会社名＋氏名一致（担当者＋顧客） ③会社名一致（顧客のみ）。手動連携はマッチングで上書きされません。
      </p>
    </div>
  );
}
