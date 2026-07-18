import Link from "next/link";
import {
  Coins, Gauge, Goal, TrendingUp, Radio, Presentation, ClipboardList, Star, UserCog, Package, ThumbsDown, Hourglass,
} from "lucide-react";
import { PageHeader, Section } from "@/components/ui/primitives";

const GROUPS: { title: string; items: { href: string; label: string; desc: string; icon: React.ElementType }[] }[] = [
  {
    title: "施策・ROI",
    items: [
      { href: "/app/analytics/roi", label: "施策ROI分析", desc: "流入施策ごとの費用対効果", icon: Gauge },
      { href: "/app/analytics/matrix", label: "施策×顧客レベル", desc: "施策別の顧客ランク構成", icon: Goal },
      { href: "/app/analytics/channels", label: "流入元分析", desc: "リード獲得チャネル別", icon: Radio },
      { href: "/app/analytics/product-roi", label: "プロダクト収益分析", desc: "商品群の収益・原価・継続", icon: Coins },
      { href: "/app/analytics/revenue", label: "売上・請求分析", desc: "売上と請求スケジュール", icon: Coins },
    ],
  },
  {
    title: "展示会",
    items: [
      // S2-3: 展示会3画面はタブで行き来できるハブに統合。入口は1つに絞る。
      { href: "/app/analytics/exhibitions", label: "展示会ハブ", desc: "基本集計・時系列/主催/テーマ・出展選定をタブで切替", icon: Presentation },
    ],
  },
  {
    title: "セミナー",
    items: [
      { href: "/app/analytics/seminar-followup", label: "セミナー攻略リスト", desc: "過去接点クロスの追客優先度", icon: Star },
      { href: "/app/analytics/seminars", label: "セミナー分析", desc: "参加者・反応の集計", icon: ClipboardList },
    ],
  },
  {
    title: "パイプライン・失注",
    items: [
      { href: "/app/analytics/winloss", label: "失注/成約分析", desc: "理由・競合・カテゴリ・月別に「なぜ勝てたか/負けたか」", icon: ThumbsDown },
      { href: "/app/analytics/stage-flow", label: "ステージ滞留分析", desc: "滞留日数・リードタイム・放置案件", icon: Hourglass },
    ],
  },
  {
    title: "その他",
    items: [
      { href: "/app/analytics/compare", label: "期間比較レポート", desc: "前月比・前年同月比を自動集計", icon: Gauge },
      { href: "/app/analytics/trends", label: "トレンド分析", desc: "月次の推移", icon: TrendingUp },
      { href: "/app/analytics/sales-reps", label: "営業マン別", desc: "担当者別の実績", icon: UserCog },
      { href: "/app/analytics/products", label: "商品別", desc: "商品群別の実績", icon: Package },
    ],
  },
];

export default function AnalyticsHubPage() {
  return (
    <div>
      <PageHeader title="分析" subtitle="施策ROI・展示会・セミナー・トレンドなどの分析をここから開きます。" />
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <Section key={g.title} title={g.title}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className="card card-pad hover:border-teal-primary/40 hover:shadow-sm transition-colors flex items-start gap-3"
                  >
                    <span className="rounded-lg bg-teal-light p-2 text-teal-deep shrink-0"><Icon size={18} /></span>
                    <span className="min-w-0">
                      <span className="block font-medium text-ink text-sm">{it.label}</span>
                      <span className="block text-xs text-ink/50 mt-0.5">{it.desc}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
