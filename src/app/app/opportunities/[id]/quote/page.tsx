import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { QuoteEditor, type QuoteLine } from "@/components/opportunities/quote-editor";

export const dynamic = "force-dynamic";

/**
 * D-3 見積書: 案件から見積書を生成する印刷ビュー。
 * 宛名・品目・金額はこの画面で編集でき、ブラウザの印刷(PDF保存)でそのまま提出できる。
 */
export default async function QuotePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireCtx();
  const sb = getSupabaseServer();
  const [{ data: opp }, { data: items }] = await Promise.all([
    sb
      .from("opportunities")
      .select("id, name, amount, accounts(name), products:primary_product_id(name)")
      .eq("id", params.id)
      .maybeSingle(),
    sb
      .from("opportunity_products")
      .select("amount, quantity, products(name)")
      .eq("opportunity_id", params.id),
  ]);
  if (!opp) notFound();

  const o = opp as unknown as {
    id: string;
    name: string;
    amount: number;
    accounts: { name: string } | null;
    products: { name: string } | null;
  };
  const lineItems = (items ?? []) as unknown as { amount: number; quantity: number; products: { name: string } | null }[];

  const lines: QuoteLine[] =
    lineItems.length > 0
      ? lineItems.map((li) => ({
          name: li.products?.name ?? o.name,
          quantity: li.quantity || 1,
          unitPrice: li.quantity ? Math.round(li.amount / li.quantity) : li.amount,
        }))
      : [{ name: o.products?.name ?? o.name, quantity: 1, unitPrice: o.amount ?? 0 }];

  return (
    <div>
      <div className="print:hidden">
        <Link href={`/app/opportunities/${o.id}`} className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
          <ChevronLeft size={16} /> 案件へ戻る
        </Link>
      </div>
      <QuoteEditor
        defaultClientName={o.accounts?.name ?? ""}
        defaultSubject={o.name}
        defaultLines={lines}
      />
    </div>
  );
}
