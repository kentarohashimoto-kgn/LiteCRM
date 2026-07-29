import { Plug, Globe, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { getSeoCredentialInfo } from "@/lib/seo/google-sa";
import { runSeoDiagnosticsAction, saveSeoPropertyAction, saveSeoSiteAction } from "@/server/actions/seo";

export const dynamic = "force-dynamic";

interface PropertyRow {
  id: string;
  name: string;
  domain: string;
  gsc_property: string | null;
  ga4_property_id: string | null;
  gsc_status: string;
  ga4_status: string;
  gsc_checked_at: string | null;
  diagnostics: Record<string, unknown> | null;
  status: string;
}

interface SiteRow {
  id: string;
  property_id: string;
  name: string;
  base_url: string;
  path_prefix: string;
  exclude_prefixes: string[] | null;
  audience: string;
  sitemap_url: string | null;
  inquiry_media: string | null;
  status: string;
}

const STATUS_LABEL: Record<string, { label: string; tone: "ok" | "ng" | "unknown" }> = {
  ok: { label: "接続OK", tone: "ok" },
  forbidden: { label: "権限なし", tone: "ng" },
  not_found: { label: "未特定", tone: "ng" },
  error: { label: "エラー", tone: "ng" },
  unknown: { label: "未診断", tone: "unknown" },
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;
  const Icon = s.tone === "ok" ? CheckCircle2 : s.tone === "ng" ? XCircle : HelpCircle;
  const cls =
    s.tone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s.tone === "ng"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-black/[0.03] text-ink/60 border-black/10";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      <Icon size={12} />
      {label ? `${label}: ${s.label}` : s.label}
    </span>
  );
}

/**
 * SEO計測の接続設定と「接続診断」。
 *
 * 診断を押すと、サービスアカウントで Search Console / GA4 に実際に到達し、
 * アクセスできるプロパティ一覧を表示する。GSCの登録形式やGA4のプロパティIDを
 * 人が事前に調べなくても、ここで実態が判明する。
 */
export default async function SeoSettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [propsR, sitesR] = await Promise.all([
    sb
      .from("seo_properties")
      .select("id, name, domain, gsc_property, ga4_property_id, gsc_status, ga4_status, gsc_checked_at, diagnostics, status")
      .order("created_at"),
    sb
      .from("seo_sites")
      .select("id, property_id, name, base_url, path_prefix, exclude_prefixes, audience, sitemap_url, inquiry_media, status")
      .order("created_at"),
  ]);
  // 稼働中のプロパティを先に出す（主対象の catorce.jp を先頭に）
  const properties = ((propsR.data ?? []) as PropertyRow[]).sort(
    (a, b) => Number(b.status === "active") - Number(a.status === "active"),
  );
  const sites = (sitesR.data ?? []) as SiteRow[];
  const cred = getSeoCredentialInfo();
  const canEdit = ["owner", "admin"].includes(ctx.role);

  return (
    <div className="space-y-5">
      <PageHeader
        title="SEO計測の接続設定"
        subtitle="Search Console / GA4 への接続と、計測するサイトの定義。「接続診断」でアクセスできるプロパティを実際に確認できます。"
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          diagnosed: "接続診断を実行しました。結果を下に表示しています。",
          property: "接続プロパティを保存しました。",
          site: "サイト設定を保存しました。",
        }}
        errorMessages={{
          forbidden: "この操作は owner / admin のみ実行できます。",
          not_configured: "サービスアカウントが未設定です。GOOGLE_SEO_SA_CREDENTIALS を設定してください。",
          ga4_format: "GA4のプロパティIDは数字のみで入力してください（例: 123456789）。",
          save_failed: "保存に失敗しました。",
        }}
      />

      <Section title="サービスアカウント" icon={<Plug size={15} />}>
        {cred.configured ? (
          <div className="space-y-2 text-sm">
            <p className="text-ink/70">
              下のメールアドレスを <strong>Search Console の「ユーザーと権限」</strong> と{" "}
              <strong>GA4 の「プロパティのアクセス管理」（閲覧者）</strong> に追加してください。追加後に「接続診断」を実行します。
            </p>
            <code className="block rounded bg-black/[0.04] px-3 py-2 text-xs break-all">{cred.clientEmail}</code>
            <p className="text-xs text-ink/50">
              資格情報の取得元:{" "}
              {cred.source === "seo"
                ? "GOOGLE_SEO_SA_CREDENTIALS（SEO専用）"
                : "GOOGLE_CHAT_SA_CREDENTIALS（Google Chat連携のサービスアカウントを流用中）"}
            </p>
          </div>
        ) : (
          <div className="text-sm text-ink/70">
            <p>
              サービスアカウントが未設定です。環境変数 <code>GOOGLE_SEO_SA_CREDENTIALS</code>{" "}
              にサービスアカウントのJSON（生 or Base64）を設定してください。
            </p>
            <p className="mt-1 text-xs text-ink/50">
              Google Chat連携で使用中のサービスアカウント（<code>GOOGLE_CHAT_SA_CREDENTIALS</code>）があれば、自動的に流用します。
            </p>
          </div>
        )}
      </Section>

      {properties.length === 0 && <EmptyState message="接続プロパティが登録されていません。" />}

      {properties.map((p) => {
        const diag = (p.diagnostics ?? {}) as Record<string, unknown>;
        const gscSites = (diag.gscSites as Array<{ siteUrl: string; permission: string }> | undefined) ?? [];
        const mySites = sites.filter((s) => s.property_id === p.id);
        // このドメインに対応する候補だけをワンクリック保存の対象にする。
        // （aicafe.jp のカードに catorce.jp を保存してしまう事故を防ぐ）
        const ownCandidates = gscSites.filter((s) => s.siteUrl.includes(p.domain));
        const otherCandidates = gscSites.filter((s) => !s.siteUrl.includes(p.domain));
        const needsSetup = !p.gsc_property && ownCandidates.length > 0;
        return (
          <Section
            key={p.id}
            title={`${p.name}（${p.domain}）`}
            icon={<Globe size={15} />}
            action={
              <div className="flex items-center gap-2">
                <StatusBadge status={p.gsc_status} label="Search Console" />
                <StatusBadge status={p.ga4_status} label="GA4" />
              </div>
            }
          >
            <div className="space-y-4">
              {/* 診断で候補が見つかったのに未設定 = あと1クリックで完了する状態。最も目立たせる。 */}
              {needsSetup && canEdit && (
                <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                  <p className="text-sm font-medium text-teal-900">
                    あと1クリックで接続できます
                  </p>
                  <p className="mt-0.5 text-xs text-teal-800">
                    診断で見つかったプロパティです。ボタンを押すとこの値が保存されます。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ownCandidates.map((s) => (
                      <form key={s.siteUrl} action={saveSeoPropertyAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="gsc_property" value={s.siteUrl} />
                        <input type="hidden" name="ga4_property_id" value={p.ga4_property_id ?? ""} />
                        <SubmitButton className="btn-primary text-sm" pendingLabel="保存中…">
                          {`「${s.siteUrl}」を使う`}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                </div>
              )}

              <form action={saveSeoPropertyAction} className="grid gap-3 md:grid-cols-[1fr_200px_auto] md:items-end">
                <input type="hidden" name="id" value={p.id} />
                <label className="block text-sm">
                  <span className="text-ink/60 text-xs">
                    Search Console プロパティ
                    {!p.gsc_property && "（未設定。下のグレー文字は入力例です）"}
                  </span>
                  <input
                    name="gsc_property"
                    defaultValue={p.gsc_property ?? ""}
                    placeholder="例) sc-domain:example.com"
                    list={`gsc-options-${p.id}`}
                    disabled={!canEdit}
                    className="mt-1 w-full rounded border border-black/10 px-2.5 py-1.5 text-sm"
                  />
                  {/* 診断で見つかったプロパティを候補として出す（手入力の取り違えを防ぐ） */}
                  <datalist id={`gsc-options-${p.id}`}>
                    {gscSites.map((s) => (
                      <option key={s.siteUrl} value={s.siteUrl} />
                    ))}
                  </datalist>
                </label>
                <label className="block text-sm">
                  <span className="text-ink/60 text-xs">GA4 プロパティID</span>
                  <input
                    name="ga4_property_id"
                    defaultValue={p.ga4_property_id ?? ""}
                    placeholder="123456789"
                    disabled={!canEdit}
                    className="mt-1 w-full rounded border border-black/10 px-2.5 py-1.5 text-sm"
                  />
                </label>
                {canEdit && <SubmitButton>保存</SubmitButton>}
              </form>

              {canEdit && (
                <form action={runSeoDiagnosticsAction}>
                  <input type="hidden" name="property_id" value={p.id} />
                  <SubmitButton className="btn-secondary" pendingLabel="診断中…">
                    接続診断を実行
                  </SubmitButton>
                </form>
              )}

              {p.gsc_checked_at && (
                <div className="rounded-lg border border-black/[0.06] bg-black/[0.02] p-3 text-sm space-y-2">
                  <p className="text-xs text-ink/50">
                    最終診断: {new Date(p.gsc_checked_at).toLocaleString("ja-JP")}
                  </p>
                  {otherCandidates.length > 0 && ownCandidates.length === 0 && (
                    <p className="text-xs text-amber-700">
                      このドメイン（{p.domain}）のプロパティは見つかりませんでした。Search
                      Consoleに未登録か、サービスアカウントに権限が付いていません。
                    </p>
                  )}
                  {gscSites.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-ink/70">
                        アクセスできる Search Console プロパティ
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {gscSites.map((s) => (
                          <li key={s.siteUrl} className="text-xs">
                            <code className="break-all">{s.siteUrl}</code>{" "}
                            <span className="text-ink/40">({s.permission})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {typeof diag.ga4Sessions7d === "number" && (
                    <p className="text-xs">
                      GA4 直近7日のセッション: <strong>{String(diag.ga4Sessions7d)}</strong>
                    </p>
                  )}
                  {["gscHint", "ga4Hint", "gscError", "ga4Error"].map((k) =>
                    diag[k] ? (
                      <p key={k} className="text-xs text-ink/70">
                        {String(diag[k])}
                      </p>
                    ) : null,
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-ink/70">計測サイト（同一ドメイン内をパスで分割）</p>
                {mySites.map((s) => (
                  <form
                    key={s.id}
                    action={saveSeoSiteAction}
                    className="grid gap-2 rounded border border-black/[0.06] p-3 md:grid-cols-[1.2fr_1fr_1fr_120px_auto] md:items-end"
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <div className="text-sm">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-ink/50 break-all">
                        {s.base_url}（{s.path_prefix}
                        {s.exclude_prefixes?.length ? ` / 除外: ${s.exclude_prefixes.join(", ")}` : ""}）
                        <span className="ml-1 rounded bg-black/[0.05] px-1">{s.audience.toUpperCase()}</span>
                      </div>
                    </div>
                    <label className="block text-sm">
                      <span className="text-ink/60 text-xs">sitemap.xml</span>
                      <input
                        name="sitemap_url"
                        defaultValue={s.sitemap_url ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded border border-black/10 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-ink/60 text-xs">問合せの media 値</span>
                      <input
                        name="inquiry_media"
                        defaultValue={s.inquiry_media ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded border border-black/10 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-ink/60 text-xs">状態</span>
                      <select
                        name="status"
                        defaultValue={s.status}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded border border-black/10 px-2 py-1 text-xs"
                      >
                        <option value="active">計測する</option>
                        <option value="planned">未着手</option>
                        <option value="paused">停止</option>
                      </select>
                    </label>
                    {canEdit && <SubmitButton className="btn-secondary text-xs">保存</SubmitButton>}
                  </form>
                ))}
              </div>
            </div>
          </Section>
        );
      })}
    </div>
  );
}
