import Link from "next/link";
import { FileText, Target, Search } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { listSeoSites } from "@/lib/data/seo";
import {
  getArticlePlans,
  DIFFICULTY_LABEL,
  PLAN_STATUS_LABEL,
  LAYER_LABEL,
} from "@/lib/data/seo-keywords";
import { startArticlePlanAction, savePlanUrlAction } from "@/server/actions/seo";
import { SiteSwitcher } from "@/components/seo/site-switcher";

export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("ja-JP");

const DIFF_TONE: Record<number, string> = {
  1: "bg-emerald-50 text-emerald-700",
  2: "bg-teal-50 text-teal-700",
  3: "bg-amber-50 text-amber-800",
  4: "bg-orange-50 text-orange-800",
  5: "bg-rose-50 text-rose-700",
};

/**
 * 記事プラン（F-307b）。
 *
 * 「沢山上位を取れる記事」を作るための設計図。
 * 1記事 = メインKW1つ + サブKW数語 とし、KW1語1記事にしない。
 * 1語1記事にすると薄い記事が量産され、サイト全体の評価が下がる。
 *
 * 並び順は 意図層 → 優先度 → 難易度。難易度の低い記事から積むのは、
 * 検索数だけで選ぶと競合が強い語ばかり狙って半年成果ゼロになるため。
 */
export default async function SeoPlansPage(
  props: {
    searchParams: Promise<{ site?: string; layer?: string; diff?: string; saved?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const sites = await listSeoSites();
  const active = sites.filter((s) => s.status === "active");
  const current = active.find((s) => s.id === searchParams.site) ?? active[0] ?? sites[0];
  if (!current) {
    return (
      <div>
        <PageHeader title="記事プラン" subtitle="1記事で複数の狙う語を取る設計図。" />
        <EmptyState message="計測サイトが未登録です。" />
      </div>
    );
  }

  const plans = await getArticlePlans(current.id);
  const layerFilter = searchParams.layer ? Number(searchParams.layer) : null;
  const diffFilter = searchParams.diff ? Number(searchParams.diff) : null;
  const rows = plans.filter(
    (p) =>
      (layerFilter == null || p.intentLayer === layerFilter) &&
      (diffFilter == null || (p.difficulty ?? 3) <= diffFilter),
  );

  const totalVolume = plans.reduce((n, p) => n + p.totalVolume, 0);
  const published = plans.filter((p) => p.status === "published").length;
  const easyPlanned = plans.filter((p) => (p.difficulty ?? 3) <= 2 && p.status === "planned").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="記事プラン"
        subtitle={`${current.name} — ${plans.length}本の記事で ${num(totalVolume)}検索/月 を狙う設計。公開済み ${published}本`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/seo/keywords" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Target size={14} />
              KW順位表
            </Link>
            <Link href="/app/seo" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Search size={14} />
              集客サマリー
            </Link>
          </div>
        }
      />

      <SiteSwitcher sites={sites} currentId={current.id} basePath="/app/seo/plans" />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          started: "記事ネタとして起票しました。「記事ネタ・ブログ」で執筆を進められます。",
          url: "対策URLを保存しました。KW順位表で実表示ページとのズレを検出できます。",
        }}
        errorMessages={{ forbidden: "この操作を行う権限がありません。", already: "この記事は既に起票済みです。" }}
      />

      {/* 難易度の低い記事から積むのが原則。ここを最初に示す */}
      {easyPlanned > 0 && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          <p className="font-medium">まず難易度の低い記事から積んでください（{easyPlanned}本が未着手）</p>
          <p className="mt-0.5 text-xs">
            検索数の大きい語（「生成AI研修」など）は大手研修会社とメディアが占有しています。
            第1層で1語も取れていない現状では届きません。ニッチ・自社商材名・ツール名×法人から積み、
            サイト全体の評価を上げてから難関語に挑みます。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={`/app/seo/plans?site=${current.id}`}
          className={`rounded-full border px-3 py-1 ${
            !layerFilter && !diffFilter ? "border-teal-500 bg-teal-50 text-teal-800" : "border-black/10 text-ink/60"
          }`}
        >
          すべて（{plans.length}）
        </Link>
        <Link
          href={`/app/seo/plans?site=${current.id}&diff=2`}
          className={`rounded-full border px-3 py-1 ${
            diffFilter === 2 ? "border-teal-500 bg-teal-50 text-teal-800" : "border-black/10 text-ink/60"
          }`}
        >
          勝ちやすい（難易度2以下・{plans.filter((p) => (p.difficulty ?? 3) <= 2).length}）
        </Link>
        {[1, 2].map((l) => (
          <Link
            key={l}
            href={`/app/seo/plans?site=${current.id}&layer=${l}`}
            className={`rounded-full border px-3 py-1 ${
              layerFilter === l ? "border-teal-500 bg-teal-50 text-teal-800" : "border-black/10 text-ink/60"
            }`}
          >
            第{l}層（{plans.filter((p) => p.intentLayer === l).length}）
          </Link>
        ))}
      </div>

      <Section title={`記事プラン（${rows.length}本）`} icon={<FileText size={15} />}>
        {rows.length === 0 ? (
          <EmptyState message="該当する記事プランがありません。" />
        ) : (
          <div className="space-y-2">
            {rows.map((p) => (
              <div key={p.planId} className="rounded-lg border border-black/[0.06] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{p.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-ink/60">
                        メインKW: {p.mainKeyword}
                      </span>
                      {p.difficulty != null && (
                        <span className={`rounded px-1.5 py-0.5 ${DIFF_TONE[p.difficulty] ?? ""}`}>
                          難易度 {p.difficulty}（{DIFFICULTY_LABEL[p.difficulty]?.label}）
                        </span>
                      )}
                      {p.intentLayer && (
                        <span className="text-ink/50">{LAYER_LABEL[p.intentLayer]?.split(" ")[0]}</span>
                      )}
                      {p.clusterName && <span className="text-ink/45">{p.clusterName}</span>}
                      <span className="rounded bg-black/[0.03] px-1.5 py-0.5 text-ink/50">
                        {PLAN_STATUS_LABEL[p.status] ?? p.status}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          p.isExistingPage ? "bg-teal-50 text-teal-700" : "bg-orange-50 text-orange-700"
                        }`}
                      >
                        {p.isExistingPage ? "既存ページ強化" : "新規作成"}
                      </span>
                    </div>
                  </div>
                  {p.status === "planned" && (
                    <form action={startArticlePlanAction}>
                      <input type="hidden" name="id" value={p.planId} />
                      <input type="hidden" name="site" value={current.id} />
                      <SubmitButton className="btn-secondary text-xs" pendingLabel="起票中…">
                        記事ネタに起票
                      </SubmitButton>
                    </form>
                  )}
                </div>

                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                  <Cell label="狙う語" value={`${p.keywordCount}語`} />
                  <Cell label="想定検索数/月" value={num(p.totalVolume)} />
                  <Cell
                    label="10位以内"
                    value={`${p.rankedTop10} / ${p.keywordCount}語`}
                    tone={p.rankedTop10 > 0 ? "ok" : undefined}
                  />
                  <Cell label="実績" value={`表示 ${num(p.impressions)} / クリック ${num(p.clicks)}`} />
                </div>

                {/* 対策URL。1検索意図=1ページの割当先。既存強化なのにURL未登録だと
                    実表示ページとのズレ（カニバリ兆候）を検出できない */}
                <form
                  action={savePlanUrlAction}
                  className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                >
                  <input type="hidden" name="id" value={p.planId} />
                  <input type="hidden" name="site" value={current.id} />
                  <span className="text-ink/45">対策URL</span>
                  <input
                    name="planned_url"
                    defaultValue={p.plannedUrl ?? ""}
                    placeholder={p.isExistingPage ? "既存ページのパスを入力（例 /st/dify-training.html）" : "公開後にパスを入力"}
                    className="w-72 max-w-full rounded border border-black/10 px-2 py-1"
                  />
                  <SubmitButton className="btn-ghost text-xs" pendingLabel="…">
                    保存
                  </SubmitButton>
                  {p.isExistingPage && !p.plannedUrl && (
                    <span className="text-amber-700">既存ページで狙う設定ですがURLが未登録です</span>
                  )}
                </form>
                {p.publishedUrl && (
                  <div className="mt-1.5 break-all text-xs text-ink/45">{p.publishedUrl}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink/50">
          1記事で複数の語を狙う設計です。KW1語ごとに1記事作ると薄い記事が量産され、サイト全体の評価が下がります。
          語ごとの順位は{" "}
          <Link href="/app/seo/keywords" className="underline">
            KW順位表
          </Link>
          で確認できます。
        </p>
      </Section>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="rounded border border-black/[0.05] px-2 py-1.5">
      <div className="text-ink/45">{label}</div>
      <div className={`mt-0.5 font-medium ${tone === "ok" ? "text-emerald-700" : "text-ink"}`}>{value}</div>
    </div>
  );
}
