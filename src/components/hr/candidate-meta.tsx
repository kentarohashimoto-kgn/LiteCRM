/** 候補者の主要条件(年齢・稼働量・単価・人事コメント)を1行で表示する共通パーツ。
 *  候補者一覧・求人詳細などで同じ見た目になるように共有する。 */

export interface CandidateMeta {
  age: number | null;
  desired_workload: string | null;
  desired_pay: string | null;
  notes: string | null; // 人事コメント
}

const clip = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max)}…` : s);

export function CandidateMetaLine({ c }: { c: CandidateMeta }) {
  if (c.age == null && !c.desired_workload && !c.desired_pay && !c.notes) return null;
  return (
    <div className="mt-1.5 flex items-baseline gap-x-3 gap-y-0.5 flex-wrap text-xs text-ink/45">
      {c.age != null && <span className="whitespace-nowrap">年齢: <span className="text-ink/70">{c.age}歳</span></span>}
      {c.desired_workload && <span className="whitespace-nowrap">稼働量: <span className="text-ink/70">{c.desired_workload}</span></span>}
      {c.desired_pay && <span className="whitespace-nowrap">単価: <span className="text-ink/70">{c.desired_pay}</span></span>}
      {c.notes && <span title={c.notes}>人事コメント: <span className="text-ink/70">{clip(c.notes)}</span></span>}
    </div>
  );
}
