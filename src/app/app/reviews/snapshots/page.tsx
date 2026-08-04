import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { listWeeklySnapshots, getWeeklySnapshotsByIds } from "@/lib/data/weekly-snapshot";
import { WeeklySnapshotsView } from "@/components/reviews/weekly-snapshots";

export const dynamic = "force-dynamic";

/**
 * 週報スナップショット。週次サマリを型化して保存し、過去分を振り返り、2世代を並べて比較する。
 * (定例会の精度向上: ランダム報告 → 型化された数字ベースの振り返り)
 */
export default async function WeeklySnapshotsPage(
  props: {
    searchParams: Promise<{ a?: string; b?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const list = await listWeeklySnapshots();

  const wantA = searchParams.a;
  const wantB = searchParams.b;
  const picked = wantA && wantB ? await getWeeklySnapshotsByIds([wantA, wantB]) : [];
  const compareA = picked.find((s) => s.id === wantA);
  const compareB = picked.find((s) => s.id === wantB);

  return (
    <div>
      <PageHeader
        title="週報スナップショット"
        subtitle="週次サマリをその瞬間で保存し、過去と並べて比較します。定例会を「型化された数字の振り返り」に。"
      />
      <WeeklySnapshotsView list={list} compareA={compareA} compareB={compareB} />
    </div>
  );
}
