import { Section } from "@/components/ui/primitives";
import { SCHEDULE_TYPES, SCHEDULE_TYPE_MAP, APPROVAL_STATUS_LABEL } from "@/lib/constants";
import type { SalesSchedule, SalesTemplate } from "@/lib/data/schedules";
import { saveScheduleAction } from "@/server/actions/schedules";
import { formatYen } from "@/lib/utils";

const APPROVAL_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-accent-orange",
  approved: "bg-teal-light text-teal-deep",
  rejected: "bg-rose-50 text-rose-500",
  needs_revision: "bg-amber-50 text-accent-orange",
};

export function ScheduleSection({
  oppId,
  schedule,
  hadFirstMeeting,
  templates,
}: {
  oppId: string;
  schedule: SalesSchedule | null;
  hadFirstMeeting: boolean;
  templates: SalesTemplate[];
}) {
  const meta = schedule ? SCHEDULE_TYPE_MAP[schedule.schedule_type] : null;
  return (
    <Section
      title="営業スケジュール分類"
      action={
        schedule ? (
          <span className={`pill text-[10px] ${APPROVAL_STYLE[schedule.approval_status] ?? "bg-mist-soft text-ink/55"}`}>
            {APPROVAL_STATUS_LABEL[schedule.approval_status] ?? schedule.approval_status}
          </span>
        ) : hadFirstMeeting ? (
          <span className="pill bg-amber-50 text-accent-orange text-[10px]">未登録</span>
        ) : null
      }
    >
      {schedule && meta && (
        <div className="mb-3 rounded-xl border border-black/[0.06] p-3">
          <div className="font-medium text-sm text-ink">{meta.label}</div>
          <div className="text-xs text-ink/50 mt-0.5">{meta.desc}・フォロー: {meta.cadence}</div>
          <div className="text-xs text-ink/70 mt-1.5 whitespace-pre-wrap">理由: {schedule.reason}</div>
          {(schedule.expected_month || schedule.win_probability != null || schedule.expected_amount != null) && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
              {schedule.expected_month && <span>成約時期(予想): <b>{schedule.expected_month.slice(0, 7)}</b></span>}
              {schedule.win_probability != null && <span>受注確度(予想): <b>{schedule.win_probability}%</b></span>}
              {schedule.expected_amount != null && <span>受注金額(予測): <b className="text-teal-deep">{formatYen(schedule.expected_amount)}</b></span>}
            </div>
          )}
          {schedule.approval_comment && (
            <div className="mt-2 rounded-lg bg-mist-soft/60 px-2.5 py-1.5 text-xs text-ink/70">本部コメント: {schedule.approval_comment}</div>
          )}
        </div>
      )}

      {templates.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold text-ink/50 mb-1">参考テンプレート（業種/職種）</div>
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id} className="text-xs text-ink/70">
                <span className="pill bg-mist-soft text-ink/55 text-[10px] mr-1.5">{t.key_name}</span>
                {t.pitch}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-1">
        <summary className="cursor-pointer text-sm font-medium text-teal-deep">{schedule ? "分類を変更" : "＋ スケジュール分類を登録"}</summary>
        <form action={saveScheduleAction} className="mt-3 space-y-3 border-t border-black/[0.05] pt-3">
          <input type="hidden" name="opportunity_id" value={oppId} />
          <div>
            <label className="label">分類 *</label>
            <select name="schedule_type" required defaultValue={schedule?.schedule_type ?? ""} className="input">
              <option value="" disabled>選択してください</option>
              {SCHEDULE_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}（{s.cadence}）</option>)}
            </select>
          </div>
          <div>
            <label className="label">分類理由 *</label>
            <textarea name="reason" required rows={2} defaultValue={schedule?.reason ?? ""} placeholder="なぜこの分類か（課題・予算・関係者・時期）" className="input" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">成約時期(予想)</label>
              <input name="expected_month" type="month" defaultValue={schedule?.expected_month?.slice(0, 7) ?? ""} className="input" />
            </div>
            <div>
              <label className="label">受注確度(予想)</label>
              <select name="win_probability" defaultValue={schedule?.win_probability != null ? String(schedule.win_probability) : ""} className="input">
                <option value="">—</option>
                {[100, 80, 60, 40, 20, 0].map((p) => <option key={p} value={p}>{p}%</option>)}
              </select>
            </div>
            <div>
              <label className="label">受注金額(予測)</label>
              <input name="expected_amount" type="number" defaultValue={schedule?.expected_amount ?? ""} placeholder="1500000" className="input" />
            </div>
          </div>
          <p className="text-[11px] text-ink/45">登録すると分類に応じたフォロータスクが自動作成され、案件の売上予測（受注時期・確度・金額）にも反映されます。</p>
          <button type="submit" className="btn-accent">分類を登録</button>
        </form>
      </details>
    </Section>
  );
}
