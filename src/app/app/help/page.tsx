import { BookOpen, Presentation, GraduationCap, ExternalLink, ArrowRight } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { PageHeader, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/** ヘルプで配信する資料。実体は public/help/*.html(静的配信)。 */
const DOCS = [
  {
    href: "/help/guide.html",
    icon: Presentation,
    tag: "まずはここから",
    tagCls: "bg-teal-primary text-white",
    title: "操作ガイド（プレゼンモード）",
    lead: "画面のどこを見て何をするかを、番号バッジ付きの図で説明します。全16スライド・約25分。",
    points: ["データの3階層とヨミの考え方", "各画面の見方（番号バッジと解説が連動）", "運用ルール5原則・最初の1週間"],
    meta: "スライド形式 ／ ←→キーで移動",
  },
  {
    href: "/help/manual.html",
    icon: BookOpen,
    tag: "詳細操作説明",
    tagCls: "bg-accent-orange text-white",
    title: "操作マニュアル（画面付き）",
    lead: "実際の画面キャプチャ付きで、全メニューの操作を網羅した詳細マニュアルです。",
    points: ["ホーム／案件／顧客／分析／レビュー", "バックオフィス／人事／設定", "用語集・ロール別の表示メニュー"],
    meta: "リファレンス ／ 画面目次から検索",
  },
  {
    href: "/help/onboarding.html",
    icon: GraduationCap,
    tag: "はじめての方へ",
    tagCls: "bg-teal-light text-teal-deep",
    title: "オンボーディング資料",
    lead: "なぜこのシステムを使うのか、どう業務リズムに組み込むかをまとめた導入資料です。",
    points: ["背景と目的（売上の因数分解）", "日次・週次・月次の業務リズム", "運用ルールと初週チェックリスト"],
    meta: "読み物 ／ 通読20分",
  },
] as const;

/** ヘルプ・マニュアル: 操作ガイド/詳細マニュアル/オンボーディング資料への入口。 */
export default async function HelpPage() {
  await requireCtx();

  return (
    <div>
      <PageHeader
        title="ヘルプ・マニュアル"
        subtitle="使い方に迷ったらここから。はじめての方は「操作ガイド」→「オンボーディング資料」の順がおすすめです。"
      />

      <Section title="">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {DOCS.map((d) => {
            const Icon = d.icon;
            return (
              <a
                key={d.href}
                href={d.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col rounded-2xl border border-black/[0.06] bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-teal-primary/40"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className={`pill ${d.tagCls} text-[10px] font-bold`}>{d.tag}</span>
                  <Icon size={20} className="text-teal-primary shrink-0" />
                </div>
                <h3 className="text-base font-bold text-ink/90 group-hover:text-teal-deep">{d.title}</h3>
                <p className="mt-1.5 text-xs text-ink/60 leading-relaxed">{d.lead}</p>
                <ul className="mt-3 space-y-1">
                  {d.points.map((p) => (
                    <li key={p} className="flex items-start gap-1.5 text-[11px] text-ink/55">
                      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-teal-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-4 flex items-center justify-between">
                  <span className="text-[10px] text-ink/40">{d.meta}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-deep">
                    開く <ExternalLink size={12} />
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      </Section>

      <Section title="よくある質問">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { q: "入力はどこまですればいい？", a: "最低限は ①ヨミ ②金額 ③次アクション（日付＋内容） ④活動記録 の4点です。ここが埋まれば予測・検知・分析はすべて動きます。" },
            { q: "ヨミの判断に迷う", a: "「次に何が起きれば前に進むか」が言えるならC以上、言えないなら定期追いです。Aは決裁が通る見込みが立っている状態に限定します。" },
            { q: "間違えて削除した", a: "リード・案件・顧客はゴミ箱に30日間保管されます（設定 → ゴミ箱）。そこから復元できます。" },
            { q: "同じ会社が2つある", a: "設定 → 重複の検出とマージで統合できます。関連データは残す側へ付け替えられます。" },
            { q: "見えない画面がある", a: "ロールによる表示制御です。営業とバックオフィスは相互に不可視の仕様。必要であれば管理者にご相談ください。" },
            { q: "AIの要約が間違っている", a: "AI確認キューの内容は下書きです。商談側で修正してから「確認済み」にしてください。修正内容が正データになります。" },
          ].map((f) => (
            <div key={f.q} className="rounded-xl border border-black/[0.06] bg-white p-4">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-light text-[11px] font-bold text-teal-deep">Q</span>
                <p className="text-sm font-semibold text-ink/85">{f.q}</p>
              </div>
              <p className="mt-2 pl-7 text-xs text-ink/60 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="困ったときの連絡先">
        <div className="rounded-xl border border-black/[0.06] bg-white overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 420 }}>
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr><th className="th">内容</th><th className="th">相談先</th></tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {[
                ["使い方・運用ルール", "チームリーダー / Sales Ops"],
                ["権限・アカウント", "管理者"],
                ["データの誤り・重複", "管理者（設定 → 重複の検出とマージ）"],
                ["不具合・改善要望", "管理者へ共有（画面名と操作手順を添えて）"],
              ].map(([k, v]) => (
                <tr key={k} className="row-hover">
                  <td className="td font-medium text-ink/80">{k}</td>
                  <td className="td text-ink/60">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink/45 inline-flex items-center gap-1">
          <ArrowRight size={12} /> 資料は新しいタブで開きます。印刷・PDF保存もそのままできます。
        </p>
      </Section>
    </div>
  );
}
