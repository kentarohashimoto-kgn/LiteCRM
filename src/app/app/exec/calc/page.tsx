import { PageHeader } from "@/components/ui/primitives";
import { SalesReverseCalc } from "@/components/exec/sales-reverse-calc";

export default function SalesCalcPage() {
  return (
    <div>
      <PageHeader title="売上逆算（必要アポ数シミュレーション）" subtitle="目標売上から、必要な受注数・アポ数を逆算。単価・成約率・既存追加・大型案件の前提を変えて感度を確認します。" />
      <SalesReverseCalc />
    </div>
  );
}
