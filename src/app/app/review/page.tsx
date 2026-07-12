import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { getReviewQueue } from "@/lib/data/review-queue";
import { ReviewQueue } from "@/components/review/review-queue";

export const dynamic = "force-dynamic";

/**
 * 確認キュー(今朝の確認)。
 * 夜間バッチ(方針A)がAI生成した下書き(議事録要約)を、営業が確認して確定する。
 * これが方針Aの「人の関所」= AIは下書きまで、確定は人。
 */
export default async function ReviewPage() {
  await requireCtx();
  const items = await getReviewQueue();

  return (
    <div>
      <PageHeader
        title="AI確認キュー"
        subtitle={`夜間バッチが作ったAI要約の下書きを確認します。内容を確かめ、必要なら商談で修正してから「確認済み」に。（確認待ち ${items.length} 件）`}
      />
      <ReviewQueue items={items} />
    </div>
  );
}
