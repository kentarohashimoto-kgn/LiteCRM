import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { listPlaybooks, filterPlaybooks } from "@/lib/data/playbooks";
import { PlaybookView } from "@/components/playbooks/playbook-view";

export const dynamic = "force-dynamic";

/**
 * B1 カトルセの型(営業プレイブック)。
 * 業種×規模×役職 別の勝ち筋を構造化して蓄積する資産。事前準備や提案の型として引き出す。
 */
export default async function PlaybooksPage(
  props: {
    searchParams: Promise<{ q?: string; industry?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const all = await listPlaybooks();

  const q = searchParams.q ?? "";
  const industry = searchParams.industry ?? "";
  const items = filterPlaybooks(all, q, industry);

  const industries = Array.from(
    new Set(all.map((p) => p.industry).filter((x): x is string => Boolean(x))),
  ).sort();

  return (
    <div>
      <PageHeader
        title="カトルセの型"
        subtitle="業種×規模×役職 別の勝ち筋（想定課題・訴求・質問・提案の流れ・切り返し・決裁の勘所）を蓄積し、商談準備で引き出します。"
      />
      <PlaybookView items={items} industries={industries} q={q} industry={industry} />
    </div>
  );
}
