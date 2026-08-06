import { Handshake, Sprout, Trophy } from "lucide-react";
import { DEAL_STAGES, DEAL_STAGE_MAP, type DealStage } from "@/lib/account-matrix";
import { cn } from "@/lib/utils";

/**
 * 取引ステージ(成約済 / 商談済 / リードのみ)の見た目を1箇所に集める。
 * マトリクスのセル・右ペイン・凡例が同じアイコンと色を使うようにするため、
 * lucide のアイコン対応表はここだけに置く。
 */

const STAGE_ICON: Record<DealStage, typeof Trophy> = {
  won: Trophy,      // 受注
  engaged: Handshake, // 商談
  lead: Sprout,     // これから育てる
};

/** セル内の顧客名の先頭に置く印。名前と揃うよう inline で出す。 */
export function DealStageIcon({
  stage,
  size = 11,
  className,
}: {
  stage: DealStage;
  size?: number;
  className?: string;
}) {
  const Icon = STAGE_ICON[stage];
  return <Icon size={size} className={cn("shrink-0", DEAL_STAGE_MAP[stage].icon, className)} aria-hidden />;
}

/** アイコン + ラベルのピル(凡例・右ペインのヘッダー用)。 */
export function DealStageBadge({ stage, className }: { stage: DealStage; className?: string }) {
  const s = DEAL_STAGE_MAP[stage];
  const Icon = STAGE_ICON[stage];
  return (
    <span className={cn("pill inline-flex items-center gap-1 text-[10px] font-bold", s.pill, className)} title={s.criteria}>
      <Icon size={11} aria-hidden />
      {s.label}
    </span>
  );
}

/** マトリクス上部の凡例。アイコンの意味が分からないと色分けが読めないので必ず添える。 */
export function DealStageLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-[11px] text-ink/50", className)}>
      <span className="font-semibold text-ink/60">取引ステージ:</span>
      {DEAL_STAGES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1" title={s.criteria}>
          <DealStageIcon stage={s.key} size={12} />
          <span className={cn("font-semibold", s.text)}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}
