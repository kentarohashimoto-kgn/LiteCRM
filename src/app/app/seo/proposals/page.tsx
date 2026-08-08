import Link from "next/link";
import { Lightbulb, Search } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { listSeoSites } from "@/lib/data/seo";
import { ACTION_PRIORS } from "@/lib/seo/expected-value";
import { reviewProposalAction } from "@/server/actions/seo";
import { SiteSwitcher } from "@/components/seo/site-switcher";

export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const dec = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ja-JP");

interface ProposalRow {
  id: string;
  title: string;
  action_type: string;
  lever: string | null;
  intent_layer: number | null;
  target_query: string;
  target_page: string;
  article_plan_id: string | null;
  evidence_json: Record<string, unknown>;
  expected_json: Record<string, number>;
  ice_score: number;
  strategy_weight: number;
  hypothesis: string | null;
  plan_md: string | null;
  status: string;
  proposed_date: string;
}

const LEVER_LABEL: Record<string, string> = {
  ctr: "CTR",
  position: "掲載順位",
  cvr: "CVR",
  engagement: "回遊",
  lead_quality: "リードの質",
};

/**
 * 改善提案の承認キュー（F-302）。
 *
 * 朝ここを開いて上から3件を承認するだけで、その日の打ち手が決まる状態にする。
 * 提案は「月いくら増えるか」で並ぶ。順位やCTRではなく金額で判断できるのが要点。
 */
export default async function SeoProposalsPage(
  props: {
    searchParams: Promise<{ site?: string; status?: string; saved?: string; error?: string }>;
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
        <PageHeader title="改善提案" subtitle="機会を、承認できる打ち手に変えます。" />
        <EmptyState message="計測サイトが未登録です。" />
      </div>
    );
  }

  const status = searchParams.status ?? "pending_review";
  const sb = getSupabaseServer();
  const [{ data }, { count }] = await Promise.all([
    sb
      .from("seo_proposals")
      .select(
        "id, title, action_type, lever, intent_layer, target_query, target_page, article_plan_id, evidence_json, expected_json, ice_score, strategy_weight, hypothesis, plan_md, status, proposed_date",
      )
      .eq("site_id", current.id)
      .eq("status", status)
      .order("ice_score", { ascending: false })
      .limit(50),
    // 表示は50件までなので、件数は別に数える（50で頭打ちの数を見せない）
    sb
      .from("seo_proposals")
      .select("id", { count: "exact", head: true })
      .eq("site_id", current.id)
      .eq("status", status),
  ]);
  const proposals = (data ?? []) as ProposalRow[];
  const totalCount = count ?? proposals.length;

  const totalRevenue = proposals.reduce((n, p) => n + Number(p.expected_json?.revenue ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="改善提案"
        subtitle={`${current.name} — 1提案＝記事1本（メインKW1つ+サブKW数語）。期待売上の大きい順。上から3件承認すれば、その日の打ち手が決まります。`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/seo/plans" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              記事プラン
            </Link>
            <Link href="/app/seo/actions" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              施策の実行
            </Link>
            <Link href="/app/seo" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Search size={14} />
              集客サマリー
            </Link>
          </div>
        }
      />

      <SiteSwitcher sites={sites} currentId={current.id} basePath="/app/seo/proposals" />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          approved: "承認しました。「施策の実行」に実行チケットと指示書を作成しました。",
          approved_dup:
            "承認しました。ただし同じページに未完了の施策があります。効果の帰属が難しくなるため、先の施策の完了後に着手してください。",
          rejected: "却下しました。同じ提案はしばらく出ません。",
        }}
        errorMessages={{ forbidden: "承認・却下は owner / admin / sales_manager のみ可能です。" }}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[
          { key: "pending_review", label: "承認待ち" },
          { key: "approved", label: "承認済み" },
          { key: "rejected", label: "却下" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/app/seo/proposals?site=${current.id}&status=${t.key}`}
            className={`rounded-full border px-3 py-1 ${
              status === t.key
                ? "border-teal-500 bg-teal-50 text-teal-800"
                : "border-black/10 text-ink/60 hover:bg-black/[0.03]"
            }`}
          >
            {t.label}
          </Link>
        ))}
        {status === "pending_review" && proposals.length > 0 && (
          <span className="ml-2 text-ink/50">
            承認待ち {totalCount}件
            {totalCount > proposals.length ? `（期待売上の大きい${proposals.length}件を表示）` : ""}・
            表示中の{proposals.length}件を全部実施すると月{yen(totalRevenue)}の見込み
          </span>
        )}
      </div>

      {proposals.length === 0 ? (
        <EmptyState
          message={
            status === "pending_review"
              ? "承認待ちの提案はありません。接続設定の「今すぐ取込を実行」で最新の検出と提案を作れます。"
              : "該当する提案はありません。"
          }
        />
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => {
            const e = p.expected_json ?? {};
            const prior = ACTION_PRIORS[p.action_type];
            // 束ねた対象クエリ（記事プラン単位・ページ単位の提案が持つ）
            const groupedQueries =
              typeof p.evidence_json?.queries === "string" ? p.evidence_json.queries : null;
            const keywordCount = Number(p.evidence_json?.keywordCount ?? 0);
            const difficulty =
              p.evidence_json?.difficulty == null ? null : Number(p.evidence_json.difficulty);
            return (
              <Section key={p.id} title={p.title} icon={<Lightbulb size={15} />}>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Tag>{prior?.label ?? p.action_type}</Tag>
                    {keywordCount > 1 && <Tag tone="accent">記事1本で{keywordCount}語</Tag>}
                    {p.lever && <Tag>{LEVER_LABEL[p.lever] ?? p.lever}に効く</Tag>}
                    {p.intent_layer === 1 && <Tag tone="accent">第1層（今すぐ客）</Tag>}
                    {p.strategy_weight > 1 && <Tag tone="accent">戦略係数 ×{p.strategy_weight}</Tag>}
                    {difficulty != null && <Tag>難易度 {difficulty}/5</Tag>}
                    <Tag>手間 {prior ? `${prior.effort}` : "—"}</Tag>
                  </div>

                  {/* 判断の材料は「月いくら増えるか」。順位やCTRではなく金額で並べる */}
                  <div className="grid gap-2 sm:grid-cols-5">
                    <Metric label="クリック" value={`+${dec(Number(e.clicks ?? 0))}`} />
                    <Metric label="問合せ" value={`+${dec(Number(e.inquiries ?? 0))}`} />
                    <Metric label="有効リード" value={`+${dec(Number(e.leads ?? 0))}`} />
                    <Metric label="商談" value={`+${dec(Number(e.opportunities ?? 0))}`} />
                    <Metric label="月あたり売上" value={yen(Number(e.revenue ?? 0))} accent />
                  </div>

                  {/* 束ねた対象クエリを常に見せる。1ページの改善が何語に効くのかが
                      分かると、承認の判断が早くなる。 */}
                  {groupedQueries && (
                    <div className="rounded-lg border border-black/[0.06] bg-black/[0.01] p-3 text-xs">
                      <div className="text-ink/50">
                        {p.article_plan_id
                          ? `この記事1本で狙う検索キーワード（${keywordCount || "—"}語）`
                          : "この1件で改善される検索キーワード"}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {groupedQueries
                          .split(" ／ ")
                          .map((line) => (
                            <li key={line} className="break-words text-ink/80">
                              ・{line}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}

                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-ink/60">根拠となる数値を見る</summary>
                    <div className="mt-2 rounded bg-black/[0.02] p-2 text-xs text-ink/70">
                      {String(p.evidence_json?.detected ?? "")}
                      <div className="mt-1 break-all">
                        {Object.entries(p.evidence_json ?? {})
                          .filter(([k]) => !["detected", "kind", "queries"].includes(k))
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(" / ")}
                      </div>
                    </div>
                  </details>

                  {p.hypothesis ? (
                    <div className="rounded-lg border border-black/[0.06] p-3 text-sm">
                      <div className="text-xs text-ink/50">なぜ効くか（AI）</div>
                      <p className="mt-1 whitespace-pre-wrap">{p.hypothesis}</p>
                      {p.plan_md && <p className="mt-2 whitespace-pre-wrap text-ink/80">{p.plan_md}</p>}
                    </div>
                  ) : (
                    <p className="text-xs text-ink/45">
                      仮説・具体的な打ち手はAIが夜間に書き足します（AIバッチ運用で「SEO提案のAI肉付け」を開始すると有効）。
                      内容は今のままでも承認・実行できます。
                    </p>
                  )}

                  {p.status === "pending_review" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={reviewProposalAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="site" value={current.id} />
                        <input type="hidden" name="to" value="approved" />
                        <SubmitButton className="btn-primary text-sm" pendingLabel="承認中…">
                          承認する
                        </SubmitButton>
                      </form>
                      {[
                        { reason: "not_now", label: "今はやらない" },
                        { reason: "not_relevant", label: "的外れ" },
                        { reason: "already_done", label: "対応済み" },
                      ].map((r) => (
                        <form key={r.reason} action={reviewProposalAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="site" value={current.id} />
                          <input type="hidden" name="to" value="rejected" />
                          <input type="hidden" name="reason" value={r.reason} />
                          <SubmitButton className="btn-secondary text-xs" pendingLabel="…">
                            {r.label}
                          </SubmitButton>
                        </form>
                      ))}
                    </div>
                  )}
                </div>
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "accent" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${
        tone === "accent" ? "bg-orange-50 text-orange-800" : "bg-black/[0.04] text-ink/60"
      }`}
    >
      {children}
    </span>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-black/[0.06] p-2">
      <div className="text-xs text-ink/50">{label}</div>
      <div className={`mt-0.5 font-bold ${accent ? "text-lg text-teal-700" : "text-base text-ink"}`}>{value}</div>
    </div>
  );
}
