"use client";

import { useState } from "react";
import { saveJobOpeningAction } from "@/server/actions/hr";
import { SubmitButton } from "@/components/ui/submit-button";
import { PRIORITIES, EMPLOYMENT_TYPE_OPTIONS } from "@/lib/hr-constants";

export interface OpeningRecord {
  id: string;
  kind: string;
  title: string;
  client_name: string | null;
  role_description: string | null;
  rate_note: string | null;
  headcount: number | null;
  priority: string | null;
  work_style: string | null;
  employment_types: string[] | null;
  workload: string | null;
  pay_rate: string | null;
  start_on: string | null;
  required_skills: string | null;
  recruit_channel: string | null;
  end_client: string | null;
  upstream_company: string | null;
  distribution: string | null;
  client_rate: string | null;
  pay_limit: string | null;
  expected_margin: string | null;
  settlement_terms: string | null;
  payment_site: string | null;
  interview_count: string | null;
  project_start_on: string | null;
  project_end_on: string | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/**
 * 求人案件の編集フォーム。区分(カトルセ人員/クライアント案件)で入力欄を出し分ける。
 * 募集要件は改行可能なtextarea。契約形態は複数選択(チェックボックス群)。
 */
export function OpeningForm({ opening }: { opening: OpeningRecord }) {
  const [kind, setKind] = useState(opening.kind || "internal");
  const v = (s: string | null) => s ?? "";

  return (
    <form action={saveJobOpeningAction} className="space-y-4">
      <input type="hidden" name="id" value={opening.id} />

      {/* 共通 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="区分 *">
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="internal">カトルセ人員</option>
            <option value="client">クライアント案件</option>
          </select>
        </Field>
        <Field label="ポジション名 *">
          <input name="title" required defaultValue={opening.title} className="input" placeholder="例: AI講師 / 開発エンジニア" />
        </Field>
        {kind === "client" && (
          <Field label="クライアント名">
            <input name="client_name" defaultValue={v(opening.client_name)} className="input" />
          </Field>
        )}
        <Field label="募集人数">
          <input name="headcount" inputMode="decimal" defaultValue={opening.headcount != null ? String(opening.headcount) : ""} className="input" placeholder="例: 2 / 1.5" />
        </Field>
        <Field label="優先度">
          <select name="priority" defaultValue={v(opening.priority)} className="input">
            <option value="">—</option>
            {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
      </div>

      {/* 募集要件(改行可能・拡大可能) */}
      <Field label="募集要件">
        <textarea name="role_description" defaultValue={v(opening.role_description)} rows={5} className="input resize-y min-h-[96px]" placeholder="必要スキル・経験・業務内容など（改行可）" />
      </Field>

      {/* カトルセ人員(internal)専用 */}
      {kind === "internal" && (
        <div className="rounded-xl border border-teal-primary/20 bg-teal-light/15 p-3 space-y-3">
          <div className="text-xs font-bold text-teal-deep">カトルセ人員の詳細</div>
          <div>
            <label className="label">契約形態（複数選択可）</label>
            <div className="flex flex-wrap gap-3 mt-1">
              {EMPLOYMENT_TYPE_OPTIONS.map((et) => (
                <label key={et} className="inline-flex items-center gap-1.5 text-sm text-ink/70">
                  <input type="checkbox" name="employment_types" value={et} defaultChecked={(opening.employment_types ?? []).includes(et)} className="accent-teal-600" />
                  {et}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="稼働量"><input name="workload" defaultValue={v(opening.workload)} className="input" placeholder="例: 週3日 / フルタイム" /></Field>
            <Field label="報酬単価"><input name="pay_rate" defaultValue={v(opening.pay_rate)} className="input" placeholder="例: 月60万 / 時給3000円" /></Field>
            <Field label="勤務形態"><input name="work_style" defaultValue={v(opening.work_style)} className="input" placeholder="例: リモート可 / 出社" /></Field>
            <Field label="開始時期"><input type="date" name="start_on" defaultValue={v(opening.start_on)} className="input" /></Field>
            <Field label="採用チャネル"><input name="recruit_channel" defaultValue={v(opening.recruit_channel)} className="input" placeholder="例: 紹介 / 媒体名" /></Field>
          </div>
          <Field label="必要スキル"><textarea name="required_skills" defaultValue={v(opening.required_skills)} rows={2} className="input resize-y" /></Field>
        </div>
      )}

      {/* クライアント案件(client)専用 */}
      {kind === "client" && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
          <div className="text-xs font-bold text-indigo-700">クライアント案件の詳細</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="エンドクライアント"><input name="end_client" defaultValue={v(opening.end_client)} className="input" /></Field>
            <Field label="上位会社・紹介元"><input name="upstream_company" defaultValue={v(opening.upstream_company)} className="input" /></Field>
            <Field label="顧客提示単価"><input name="client_rate" defaultValue={v(opening.client_rate)} className="input" /></Field>
            <Field label="人材への支払上限"><input name="pay_limit" defaultValue={v(opening.pay_limit)} className="input" /></Field>
            <Field label="想定粗利"><input name="expected_margin" defaultValue={v(opening.expected_margin)} className="input" /></Field>
            <Field label="精算幅・精算条件"><input name="settlement_terms" defaultValue={v(opening.settlement_terms)} className="input" /></Field>
            <Field label="支払いサイト"><input name="payment_site" defaultValue={v(opening.payment_site)} className="input" placeholder="例: 月末締め翌月末払い" /></Field>
            <Field label="面談回数"><input name="interview_count" defaultValue={v(opening.interview_count)} className="input" placeholder="例: 1回 / 2回" /></Field>
            <Field label="案件開始日"><input type="date" name="project_start_on" defaultValue={v(opening.project_start_on)} className="input" /></Field>
            <Field label="終了予定日"><input type="date" name="project_end_on" defaultValue={v(opening.project_end_on)} className="input" /></Field>
            <Field label="勤務形態"><input name="work_style" defaultValue={v(opening.work_style)} className="input" placeholder="例: 出社条件・リモート可否など" /></Field>
          </div>
          <Field label="商流"><textarea name="distribution" defaultValue={v(opening.distribution)} rows={2} className="input resize-y" placeholder="商流（個人事業主可否もここに記入）" /></Field>
        </div>
      )}

      {/* メモ(旧: 単価・条件メモ) */}
      <Field label="メモ">
        <textarea name="rate_note" defaultValue={v(opening.rate_note)} rows={2} className="input resize-y" />
      </Field>

      <SubmitButton className="btn-accent" pendingLabel="保存中…">保存</SubmitButton>
    </form>
  );
}
