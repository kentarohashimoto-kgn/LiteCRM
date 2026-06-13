import { getWorkspace } from "@/lib/data/workspace";
import { listSeminarResponses } from "@/lib/data/select";
import { PageHeader, Section, StatCard } from "@/components/ui/primitives";
import { formatDateFull } from "@/lib/utils";

function avg(ns: number[]): number {
  const v = ns.filter((n) => n != null);
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0;
}
function rank(values: string[]): { k: string; n: number }[] {
  const m = new Map<string, number>();
  for (const v of values) {
    for (const part of (v || "").split(/[,、]/)) {
      const k = part.trim();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
}
const isHot = (f?: string) => /話を聞いて|もう少し話/.test(f ?? "");
const isWarm = (f?: string) => /資料がほしい|資料が欲しい/.test(f ?? "");

export default async function SeminarAnalyticsPage() {
  const ws = await getWorkspace();
  const res = listSeminarResponses(ws);
  const n = res.length;

  const satAvg = avg(res.map((r) => r.satisfaction ?? 0));
  const undAvg = avg(res.map((r) => r.understanding ?? 0));
  const hot = res.filter((r) => isHot(r.follow_up));
  const warm = res.filter((r) => isWarm(r.follow_up) && !isHot(r.follow_up));
  const followActionable = hot.length + warm.length;

  const satDist = [5, 4, 3, 2, 1].map((s) => ({ s, n: res.filter((r) => r.satisfaction === s).length }));
  const challenges = rank(res.map((r) => r.challenges ?? ""));
  const follows = rank(res.map((r) => r.follow_up ?? ""));
  const aiUsage = rank(res.map((r) => r.ai_usage ?? ""));
  const maxC = Math.max(1, ...challenges.map((c) => c.n));
  const maxF = Math.max(1, ...follows.map((c) => c.n));
  const maxA = Math.max(1, ...aiUsage.map((c) => c.n));
  const hotLeads = [...hot, ...warm];

  return (
    <div className="space-y-5">
      <PageHeader title="セミナー分析" subtitle="セミナーアンケートの満足度・課題・AI活用度・フォロー希望を分析し、ホットな見込みを抽出します。" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="回答数" raw={`${n}`} sub="ODEX共催セミナー(5/13)" />
        <StatCard label="平均満足度" raw={satAvg.toFixed(2)} sub="／5" accent />
        <StatCard label="平均理解度" raw={undAvg.toFixed(2)} sub="／5" />
        <StatCard label="要フォロー" raw={`${followActionable}`} sub="話を聞きたい/資料希望" />
        <StatCard label="ホット(話を聞きたい)" raw={`${hot.length}`} accent sub="最優先フォロー" />
      </div>

      {hotLeads.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]">
            <h2 className="section-title">要フォロー リード（話を聞きたい / 資料希望）</h2>
          </div>
          <table className="w-full">
            <thead className="border-b border-black/[0.06]">
              <tr>
                <th className="th">会社 / 氏名</th>
                <th className="th">役職 / 規模</th>
                <th className="th text-right">満足度</th>
                <th className="th">フォロー希望</th>
                <th className="th">連絡先</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {hotLeads.map((r) => (
                <tr key={r.id} className={isHot(r.follow_up) ? "bg-amber-50/40" : ""}>
                  <td className="td"><span className="font-medium block">{r.company}</span><span className="text-xs text-ink/45">{r.name}</span></td>
                  <td className="td text-xs text-ink/60">{r.job_title || "—"}<span className="block text-ink/40">{r.employee_size}</span></td>
                  <td className="td text-right tabular-nums font-semibold">{r.satisfaction ?? "—"}</td>
                  <td className="td text-xs">
                    {isHot(r.follow_up) && <span className="pill bg-rose-100 text-rose-600 text-[10px] mr-1">話を聞きたい</span>}
                    {isWarm(r.follow_up) && <span className="pill bg-amber-50 text-accent-orange text-[10px]">資料希望</span>}
                  </td>
                  <td className="td text-xs text-ink/60">{r.email}<span className="block">{r.phone}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="満足度の分布">
          <div className="space-y-2">
            {satDist.map((d) => (
              <div key={d.s} className="flex items-center gap-3">
                <span className="w-10 text-xs text-ink/60">★{d.s}</span>
                <div className="flex-1 h-3 rounded-full bg-mist-soft overflow-hidden">
                  <div className="h-full rounded-full bg-teal-primary" style={{ width: `${n ? (d.n / n) * 100 : 0}%` }} />
                </div>
                <span className="w-10 text-right text-sm tabular-nums">{d.n}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="生成AIの活用度">
          <BarList rows={aiUsage} max={maxA} />
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="課題ランキング（複数回答）">
          <BarList rows={challenges} max={maxC} tone="orange" />
        </Section>
        <Section title="希望フォロー（複数回答）">
          <BarList rows={follows} max={maxF} />
        </Section>
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04]"><h2 className="section-title">回答一覧</h2></div>
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th">回答日時</th>
              <th className="th">会社 / 氏名</th>
              <th className="th text-right">満足/理解</th>
              <th className="th">課題</th>
              <th className="th">AI活用度</th>
              <th className="th">感想</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {res.map((r) => (
              <tr key={r.id} className="row-hover">
                <td className="td text-xs whitespace-nowrap">{formatDateFull(r.responded_at)}</td>
                <td className="td"><span className="font-medium block truncate max-w-[180px]">{r.company}</span><span className="text-xs text-ink/45">{r.name}</span></td>
                <td className="td text-right tabular-nums text-xs">{r.satisfaction ?? "—"} / {r.understanding ?? "—"}</td>
                <td className="td text-xs text-ink/60 max-w-[200px] truncate" title={r.challenges}>{r.challenges || "—"}</td>
                <td className="td text-xs text-ink/60 max-w-[160px] truncate" title={r.ai_usage}>{r.ai_usage || "—"}</td>
                <td className="td text-xs text-ink/50 max-w-[220px] truncate" title={r.comment}>{r.comment || (r.satisfaction_reason ? `(理由) ${r.satisfaction_reason}` : "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/40">
        ※ セミナーアンケートはリード(展示会)とは別管理です。「話を聞きたい/資料希望」は即フォロー対象。満足度が低い回答（駆け足等の指摘）は運営改善のヒントです。
      </p>
    </div>
  );
}

function BarList({ rows, max, tone = "teal" }: { rows: { k: string; n: number }[]; max: number; tone?: "teal" | "orange" }) {
  if (rows.length === 0) return <p className="text-sm text-ink/40 py-2">データなし</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-3">
          <span className="w-40 text-xs text-ink/70 truncate" title={r.k}>{r.k}</span>
          <div className="flex-1 h-3 rounded-full bg-mist-soft overflow-hidden">
            <div className={`h-full rounded-full ${tone === "orange" ? "bg-accent-orange" : "bg-teal-primary"}`} style={{ width: `${(r.n / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-sm tabular-nums">{r.n}</span>
        </div>
      ))}
    </div>
  );
}
