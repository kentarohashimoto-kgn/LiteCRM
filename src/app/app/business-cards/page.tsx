import Link from "next/link";
import { Contact, Upload } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, LinkButton, Card } from "@/components/ui/primitives";
import { queryBusinessCards, getCardStats, getAccountIndustries, type CardListFilters } from "@/lib/data/business-cards";
import { MatchRunButton } from "@/components/business-cards/match-run-button";
import { CardLinkCell } from "@/components/business-cards/card-link-cell";
import { CardPrioritySelect } from "@/components/business-cards/card-priority-select";
import { StickyGrid } from "@/components/ui/sticky-grid";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * 名刺情報一覧（組織共有）。
 * 個人が交換した名刺をテナント全員で閲覧・検索し、CRM顧客との連携状態を確認できる。
 * 検索は2系統: ①ピンポイント（会社名・氏名で連絡先を引く） ②セグメント（条件で複数リストアップ）。
 */
export default async function BusinessCardsPage({
  searchParams,
}: {
  searchParams: {
    q?: string; link?: string; page?: string;
    owner?: string; from?: string; to?: string; title?: string; industry?: string; address?: string; emp?: string; pri?: string; tag?: string;
  };
}) {
  await requireCtx();
  const sp = searchParams;
  const clean = (v?: string) => (v ?? "").trim() || undefined;
  const filters: CardListFilters = {
    q: sp.q ?? "",
    link: sp.link === "linked" || sp.link === "unlinked" ? sp.link : "all",
    ownerId: clean(sp.owner),
    from: clean(sp.from),
    to: clean(sp.to),
    title: clean(sp.title),
    address: clean(sp.address),
    industry: clean(sp.industry),
    employeeSize: clean(sp.emp),
    priority: ["high", "medium", "low", "none"].includes(sp.pri ?? "") ? (sp.pri as CardListFilters["priority"]) : undefined,
    tag: clean(sp.tag),
    page: sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1,
    pageSize: PAGE_SIZE,
  };
  const sb = getSupabaseServer();
  const [{ rows, total }, stats, profilesR, industries] = await Promise.all([
    queryBusinessCards(filters),
    getCardStats(),
    sb.from("profiles").select("id, display_name"),
    getAccountIndustries(),
  ]);
  const profiles = (profilesR.data ?? []) as { id: string; display_name: string | null }[];
  const nameById = new Map(profiles.map((p) => [p.id, p.display_name as string]));
  const exchangers = profiles
    .filter((p) => p.display_name)
    .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? "", "ja"));
  const segmentActive = !!(filters.ownerId || filters.from || filters.to || filters.title || filters.address || filters.industry || filters.employeeSize || filters.priority || filters.tag);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    if (filters.q) p.set("q", filters.q);
    if (filters.link !== "all") p.set("link", filters.link);
    if (filters.ownerId) p.set("owner", filters.ownerId);
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.title) p.set("title", filters.title);
    if (filters.industry) p.set("industry", filters.industry);
    if (filters.address) p.set("address", filters.address);
    if (filters.employeeSize) p.set("emp", filters.employeeSize);
    if (filters.priority) p.set("pri", filters.priority);
    if (filters.tag) p.set("tag", filters.tag);
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

      {/* 検索（1つのGETフォームに2系統: ピンポイント＋セグメント） */}
      <form method="GET" className="card card-pad mb-4 space-y-4">
        {/* ① ピンポイント: あの人の連絡先を引く */}
        <div>
          <div className="text-xs font-semibold text-ink/50 mb-1.5">ピンポイント検索（会社名・氏名で連絡先を引く）</div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="会社名・氏名・部署・役職・メール・メモ"
              className="flex-1 min-w-60 rounded-xl border border-black/10 px-3 py-2 text-sm"
            />
            <select name="link" defaultValue={filters.link} className="rounded-xl border border-black/10 px-3 py-2 text-sm">
              <option value="all">すべて</option>
              <option value="linked">連携済みのみ</option>
              <option value="unlinked">未連携のみ</option>
            </select>
            <button type="submit" className="btn-primary">検索</button>
            {(filters.q || filters.link !== "all" || segmentActive) && (
              <Link href="/app/business-cards" className="text-sm text-ink/50 hover:text-ink">クリア</Link>
            )}
          </div>
        </div>

        {/* ② セグメント: 条件で複数リストアップ */}
        <details open={segmentActive} className="border-t border-black/[0.06] pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink/50 mb-1">
            セグメント検索（条件で複数リストアップ）{segmentActive && <span className="ml-1.5 pill bg-teal-light text-teal-deep text-[10px]">適用中</span>}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">交換者</span>
              <select name="owner" defaultValue={filters.ownerId ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
                <option value="">すべて</option>
                {exchangers.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">名刺交換日（範囲）</span>
              <div className="flex items-center gap-1.5">
                <input type="date" name="from" defaultValue={filters.from ?? ""} className="w-full rounded-lg border border-black/10 px-2 py-2 text-sm" />
                <span className="text-ink/40 text-xs">〜</span>
                <input type="date" name="to" defaultValue={filters.to ?? ""} className="w-full rounded-lg border border-black/10 px-2 py-2 text-sm" />
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">役職</span>
              <input name="title" defaultValue={filters.title ?? ""} placeholder="例: 部長 / 代表 / 情シス" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">業種（連携先の顧客）</span>
              <input name="industry" defaultValue={filters.industry ?? ""} list="card-industries" placeholder="例: 製造 / 建設 / ISP" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
              <datalist id="card-industries">
                {industries.map((v) => <option key={v} value={v} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">住所</span>
              <input name="address" defaultValue={filters.address ?? ""} placeholder="例: 東京都 / 大阪 / 名古屋市" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">従業員数（連携先の顧客）</span>
              <input name="emp" defaultValue={filters.employeeSize ?? ""} placeholder="例: 1000 / 100〜300" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">アクション優先度</span>
              <select name="pri" defaultValue={filters.priority ?? ""} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm">
                <option value="">すべて</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
                <option value="none">未設定</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink/50 mb-1">アクションタグ</span>
              <input name="tag" defaultValue={filters.tag ?? ""} placeholder="例: 要フォロー" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="submit" className="btn-primary">この条件でリストアップ</button>
            <span className="text-xs text-ink/45">業種・従業員数はCRM連携済みの名刺（顧客情報）が対象です。</span>
          </div>
        </details>
      </form>

      <div className="card">
        <StickyGrid freeze maxHeight="66vh">
        <table className="w-full text-sm" style={{ minWidth: 1800 }}>
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">会社名</th>
              <th className="th whitespace-nowrap">優先度</th>
              <th className="th whitespace-nowrap">名刺交換日</th>
              <th className="th">部署名</th>
              <th className="th">役職</th>
              <th className="th">氏名</th>
              <th className="th">e-mail</th>
              <th className="th whitespace-nowrap">郵便番号</th>
              <th className="th">住所</th>
              <th className="th whitespace-nowrap">TEL会社</th>
              <th className="th whitespace-nowrap">TEL部門</th>
              <th className="th whitespace-nowrap">TEL直通</th>
              <th className="th whitespace-nowrap">Fax</th>
              <th className="th whitespace-nowrap">携帯電話</th>
              <th className="th">URL</th>
              <th className="th">タグ</th>
              <th className="th whitespace-nowrap">交換者</th>
              <th className="th">CRM連携</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((c) => (
              <tr key={c.id} className="row-hover align-top">
                <td className="td font-medium max-w-52">
                  <Link href={`/app/business-cards/${c.id}`} className="block truncate text-teal-deep hover:underline" title={c.company_name}>{c.company_name || "—"}</Link>
                </td>
                <td className="td whitespace-nowrap"><CardPrioritySelect cardId={c.id} priority={c.priority ?? null} /></td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.exchanged_on ?? "—"}</td>
                <td className="td text-xs text-ink/70 max-w-40"><div className="truncate" title={c.department ?? ""}>{c.department || "—"}</div></td>
                <td className="td text-xs text-ink/70 max-w-40"><div className="truncate" title={c.title ?? ""}>{c.title || "—"}</div></td>
                <td className="td whitespace-nowrap">
                  <Link href={`/app/business-cards/${c.id}`} className="text-teal-deep hover:underline">{c.full_name || "—"}</Link>
                  {c.rank && <span className="ml-1.5 pill text-[10px]">{c.rank}</span>}
                </td>
                <td className="td text-xs text-ink/70 max-w-52"><div className="truncate" title={c.email ?? ""}>{c.email || "—"}</div></td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.postal_code || "—"}</td>
                <td className="td text-xs text-ink/60 max-w-64"><div className="truncate" title={c.address ?? ""}>{c.address || "—"}</div></td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.tel_company || "—"}</td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.tel_department || "—"}</td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.tel_direct || "—"}</td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.fax || "—"}</td>
                <td className="td text-xs text-ink/60 whitespace-nowrap">{c.mobile_phone || "—"}</td>
                <td className="td text-xs max-w-48">
                  {c.url ? (
                    <a href={/^https?:\/\//i.test(c.url) ? c.url : `https://${c.url}`} target="_blank" rel="noreferrer noopener" className="text-teal-deep hover:underline block truncate" title={c.url}>{c.url}</a>
                  ) : "—"}
                </td>
                <td className="td max-w-44">
                  <div className="flex flex-wrap gap-1">
                    {(c.user_tags ?? []).slice(0, 3).map((t) => (
                      <Link key={`u-${t}`} href={`/app/business-cards?tag=${encodeURIComponent(t)}`} className="rounded-full bg-accent-orange/10 text-accent-orange border border-accent-orange/20 px-1.5 py-0.5 text-[10px] hover:bg-accent-orange/20" title={`タグ「${t}」で絞り込む`}>{t.length > 12 ? t.slice(0, 12) + "…" : t}</Link>
                    ))}
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
                <td colSpan={18} className="td text-center text-ink/40 py-10">
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
        </StickyGrid>
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
