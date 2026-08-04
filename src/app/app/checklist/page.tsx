import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { getChecklistBoard } from "@/lib/data/checklist";
import { ChecklistView } from "@/components/checklist/checklist-view";

export const dynamic = "force-dynamic";

/**
 * B5 営業チェックシート(抜け漏れ可視化)。
 * 進行中案件について、型の必須項目が入力されているかを自動判定し、行動漏れを可視化する。
 */
export default async function ChecklistPage(props: { searchParams: Promise<{ gap?: string }> }) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const gapOnly = searchParams.gap === "1";
  const board = await getChecklistBoard(gapOnly);

  return (
    <div>
      <PageHeader
        title="商談チェック"
        subtitle="進行中案件の「型の必須項目」の入力漏れを自動チェック。抜けを埋めて取りこぼしを防ぎます。"
      />
      <ChecklistView board={board} gapOnly={gapOnly} />
    </div>
  );
}
