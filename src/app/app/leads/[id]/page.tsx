import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { updateLeadAction, deleteLeadAction } from "@/server/actions";
import { PromoteLeadButton } from "@/components/leads/promote-button";
import { RecordRecent } from "@/components/layout/recent-items";
import { getLead, getPersonEngagement, getPersonTouchpoints } from "@/lib/data/leads";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import { ROLE_LEVELS, NEEDS_OPTS, TIMING_OPTS, AUTHORITY_OPTS, BUDGET_OPTS, REVENUE_OPTS } from "@/lib/lead-import";
import { formatAcquiredAt, formatDateFull, formatDateTimeJst } from "@/lib/utils";
import { DocumentSection } from "@/components/documents/document-section";
import { DataPath, EditTarget, entityBorder } from "@/components/layout/data-path";
import { MAIL_TOUCH_LABEL, GRADE_DEFS, type PriorityGrade } from "@/lib/engagement";
import { SubmitButton } from "@/components/ui/submit-button";

const TP_LABEL: Record<string, string> = {
  exhibition: "展示会で名刺交換", call: "架電ログ", seminar: "セミナー参加", survey: "アンケート回答",
  doc_request: "資料請求", meeting: "商談実施", meeting_repeat: "再商談", visit: "訪問", proposal: "見積・提案提出",
  ...MAIL_TOUCH_LABEL, // メール反応(開封/クリック/資料閲覧/返信) — /api/cron/engagement が記録
};
const ENG_COLOR: Record<string, string> = {
  S: "bg-rose-100 text-rose-600", A: "bg-amber-100 text-amber-700", B: "bg-teal-light text-teal-deep",
  C: "bg-mist-soft text-ink/60", D: "bg-mist-soft text-ink/40",
};
/** 接客者(handled_by)の判定根拠。0177 assign_lead_handlers が設定する。 */
const HANDLER_SRC_LABEL: Record<string, string> = {
  memo: "メモから判定", card: "名刺から判定", both: "メモ+名刺", manual: "手動設定",
};

export default async function LeadEditPage({ params }: { params: { id: string } }) {
  const l = await getLead(params.id);
  if (!l) notFound();
  const ev = l.raw_event ?? "—";
  // getLeadはselect("*")のためスコア列は取得済み(Lead型に未宣言のためcastで参照)
  const sc = l as unknown as {
    lead_score?: number | null;
    lead_score_detail?: { size?: number; role?: number; issue?: number; timing?: number; fit?: number; auto_rank?: string } | null;
    first_contact_due_date?: string | null;
    priority_grade?: PriorityGrade | null;
    last_engaged_at?: string | null;
  };
  // 獲得情報(Lead型に未宣言の列はcastで参照。getLeadはselect("*"))
  const acq = l as unknown as {
    acquirer?: string | null;
    scanned_at?: string | null;
    created_at?: string | null;
    handled_by?: string | null;
    handled_by_source?: string | null;
  };
  const converted = !!l.account_id || l.status === "converted";
  // E-1軽量化: workspace_full(2.1MB)ではなく、このリードに紐づく案件のみ直接取得
  const sb = getSupabaseServer();
  const [{ data: linkedOppRow }, eng, touchpoints] = await Promise.all([
    sb.from("opportunities").select("id, name").eq("lead_id", l.id).limit(1).maybeSingle(),
    getPersonEngagement(l.email),
    getPersonTouchpoints(l.email),
  ]);
  const linkedOpp = (linkedOppRow ?? undefined) as { id: string; name: string } | undefined;

  return (
    <div className="max-w-3xl">
      <RecordRecent href={`/app/leads/${l.id}`} label={`${l.company_name ?? ""} ${l.contact_name ?? ""}`.trim() || "リード"} kind="リード" />
      <Link href="/app/leads" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> リード一覧
      </Link>
      {/* データ階層: リード(いまここ) > 顧客 > 案件(案件化済みの場合) */}
      <DataPath
        items={[
          { level: "lead", name: l.company_name ?? undefined, current: true },
          ...(l.account_id ? [{ level: "account" as const, href: `/app/accounts/${l.account_id}` }] : []),
          ...(linkedOpp ? [{ level: "opportunity" as const, name: linkedOpp.name, href: `/app/opportunities/${linkedOpp.id}` }] : []),
        ]}
      />
      <PageHeader
        title={l.company_name ?? "リード"}
        subtitle={`${l.contact_name ?? ""}｜流入: ${ev}｜優先度 ${l.priority_score ?? 0}`}
        action={
          converted ? (
            linkedOpp ? (
              <Link href={`/app/opportunities/${linkedOpp.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-deep hover:underline">案件化済み｜商談を開く →</Link>
            ) : (
              <span className="pill bg-teal-light text-teal-deep">案件化済み</span>
            )
          ) : (
            <PromoteLeadButton leadId={l.id} />
          )
        }
      />

      {/* 獲得情報(誰が・いつ獲得したか)。取込時のデータをそのまま表示する参照専用ブロック */}
      <Card className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-ink">獲得情報</span>
          {acq.handled_by && (
            <span className="pill bg-rose-100 text-rose-700 text-[11px] font-bold" title="展示会で実際に接客した担当者。社長・責任者の接客はスコアで優遇されます">
              接客: {acq.handled_by}
              {acq.handled_by_source && <span className="font-normal opacity-70 ml-1">（{HANDLER_SRC_LABEL[acq.handled_by_source] ?? acq.handled_by_source}）</span>}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          {[
            ["流入元", ev],
            ["獲得担当", acq.acquirer || "—"],
            ["獲得日時", formatAcquiredAt(acq.scanned_at, l.acquired_at)],
            ["取込日時", formatDateTimeJst(acq.created_at)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-ink/40">{label}</dt>
              <dd className="text-ink/80 mt-0.5 break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {!acq.scanned_at && (
          <p className="text-[11px] text-ink/40 mt-2">※ 獲得日時は、QRスキャン時刻が記録されているリードのみ分単位で表示されます（名刺取込などは日付のみ）。</p>
        )}
      </Card>

      {/* リードスコア(要件書4.10の5軸) */}
      {sc.lead_score != null && (
        <Card className="mb-5">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-sm font-semibold text-ink">リードスコア</span>
            <span className={`pill text-sm font-bold ${ENG_COLOR[sc.lead_score_detail?.auto_rank ?? "D"]}`}>自動ランク {sc.lead_score_detail?.auto_rank ?? "D"}</span>
            <span className="tabular-nums font-bold text-teal-deep">{sc.lead_score} / 100</span>
            {sc.first_contact_due_date && <span className="text-xs text-accent-orange">初回接触期限 {formatDateFull(sc.first_contact_due_date)}</span>}
            <span className="ml-auto text-[11px] text-ink/40">保存で再計算</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/60">
            <span>規模 <b className="tabular-nums">{sc.lead_score_detail?.size ?? 0}</b>/20</span>
            <span>役職 <b className="tabular-nums">{sc.lead_score_detail?.role ?? 0}</b>/20</span>
            <span>課題 <b className="tabular-nums">{sc.lead_score_detail?.issue ?? 0}</b>/25</span>
            <span>時期 <b className="tabular-nums">{sc.lead_score_detail?.timing ?? 0}</b>/15</span>
            <span>相性(予算) <b className="tabular-nums">{sc.lead_score_detail?.fit ?? 0}</b>/20</span>
          </div>
        </Card>
      )}

      {/* エンゲージメント(接点の積み上げ) */}
      <Card className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-ink">エンゲージメント</span>
            <span className={`pill text-sm font-bold ${ENG_COLOR[eng?.rank ?? "D"]}`}>{eng?.rank ?? "D"}</span>
            <span className="text-xs text-ink/50 tabular-nums">{eng?.score ?? 0} pt・接点 {eng?.touch_count ?? touchpoints.length} 件</span>
            {sc.priority_grade && (
              <span className="pill text-xs font-bold bg-rose-100 text-rose-700" title="Fit(属性)×Engagement(反応)の優先グレード">
                {GRADE_DEFS[sc.priority_grade].label} — {GRADE_DEFS[sc.priority_grade].action}
              </span>
            )}
          </div>
          <span className="text-[11px] text-ink/40">名刺→架電→セミナー→アンケート→商談→提案…と接点が増えるほど高ランク</span>
        </div>
        {touchpoints.length === 0 ? (
          <p className="text-xs text-ink/40">接点の記録はまだありません。</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {touchpoints.map((t, i) => (
              <li key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-mist-soft/70 px-2.5 py-1 text-xs">
                <span className="font-medium text-ink/80">{TP_LABEL[t.type] ?? t.type}</span>
                <span className="text-ink/40">+{t.weight}</span>
                {t.occurred_at && <span className="text-ink/35">{formatDateFull(t.occurred_at)}</span>}
                {typeof (t.meta as { seminar?: string; event?: string }).seminar === "string" && <span className="text-ink/40">（{(t.meta as { seminar?: string }).seminar}）</span>}
                {typeof (t.meta as { event?: string }).event === "string" && <span className="text-ink/40">（{(t.meta as { event?: string }).event}）</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form action={updateLeadAction} className="space-y-5">
        <input type="hidden" name="id" value={l.id} />
        <input type="hidden" name="priority_base" value={l.priority_base ?? 20} />

        <Section title="基本情報" className={entityBorder("lead")} action={<EditTarget level="lead" />}>
          <div className="grid grid-cols-2 gap-4">
            <F label="会社名"><input name="company_name" defaultValue={l.company_name ?? ""} className="input" /></F>
            <F label="氏名"><input name="contact_name" defaultValue={l.contact_name ?? ""} className="input" /></F>
            <F label="メール"><input name="email" defaultValue={l.email ?? ""} className="input" /></F>
            <F label="電話(代表)"><input name="phone" defaultValue={l.phone ?? ""} className="input" /></F>
            <F label="携帯電話"><input name="mobile_phone" defaultValue={l.mobile_phone ?? ""} className="input" /></F>
            <F label="部署"><input name="department" defaultValue={l.department ?? ""} className="input" /></F>
            <F label="役職(テキスト)"><input name="job_title" defaultValue={l.job_title ?? ""} className="input" /></F>
            <F label="業種"><input name="industry" defaultValue={l.industry ?? ""} className="input" /></F>
            <F label="都道府県"><input name="prefecture" defaultValue={l.prefecture ?? ""} className="input" /></F>
          </div>
        </Section>

        <Section title="優先度の項目（規模×役職×ニーズ×時期×権限×予算）" action={<span className="text-xs text-ink/40">保存でスコア再計算</span>}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <F label="従業員規模"><input name="employee_size" defaultValue={l.employee_size ?? ""} className="input" placeholder="例：1,000名以上" /></F>
            <Sel label="売上規模" name="revenue_size" value={l.revenue_size} opts={REVENUE_OPTS} />
            <Sel label="役職区分" name="role_level" value={l.role_level} opts={ROLE_LEVELS} />
            <Sel label="ニーズ" name="needs" value={l.needs} opts={NEEDS_OPTS} />
            <Sel label="タイミング" name="timing" value={l.timing} opts={TIMING_OPTS} />
            <Sel label="権限" name="authority" value={l.authority} opts={AUTHORITY_OPTS} />
            <Sel label="予算" name="budget_band" value={l.budget_band} opts={BUDGET_OPTS} />
            <F label="予算額(円)"><input name="budget_amount" type="number" defaultValue={l.budget_amount ?? ""} className="input" /></F>
          </div>
          <p className="text-[11px] text-ink/40 mt-2">※ リードから取得できない項目は空でOK。分かった時点で入力すると優先度が更新されます。</p>
        </Section>

        <Section title="架電・決着">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <F label="ランク"><input name="rank" defaultValue={l.rank ?? ""} className="input" /></F>
            <Sel label="決着" name="disposition" value={l.disposition} opts={LEAD_DISPOSITIONS} />
            <F label="架電担当"><input name="call_owner" defaultValue={l.call_owner ?? ""} className="input" /></F>
          </div>
          <F label="メモ"><textarea name="notes" rows={2} defaultValue={l.notes ?? ""} className="input" /></F>
        </Section>

        <SubmitButton className="btn-primary" pendingLabel="保存中…">保存する</SubmitButton>
      </form>

      <div className="mt-6">
        <DocumentSection targetType="lead" targetId={l.id} revalidatePath={`/app/leads/${l.id}`} />
      </div>

      {/* 削除(控えめ・確認つき) */}
      <Card className="mt-8 border-l-4 border-l-rose-300">
        <details>
          <summary className="cursor-pointer text-sm text-ink/50">危険な操作（このリードを削除）</summary>
          <form action={deleteLeadAction} className="mt-3 flex items-center gap-3">
            <input type="hidden" name="id" value={l.id} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100">
              <Trash2 size={15} /> このリードを削除する
            </button>
            <span className="text-xs text-ink/40">削除後30日間は「設定 → ゴミ箱」から復元できます。取込のやり直しは「取込履歴」からの一括取り消しが安全です。</span>
          </form>
        </details>
      </Card>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
function Sel({ label, name, value, opts }: { label: string; name: string; value?: string; opts: { key: string; label: string }[] }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select name={name} defaultValue={value ?? ""} className="input">
        <option value="">—</option>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  );
}
