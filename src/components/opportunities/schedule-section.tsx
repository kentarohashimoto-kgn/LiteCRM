import { Section } from "@/components/ui/primitives";
import { SCHEDULE_TYPES, SCHEDULE_TYPE_MAP, APPROVAL_STATUS_LABEL } from "@/lib/constants";
import type { SalesSchedule, SalesTemplate } from "@/lib/data/schedules";
import { saveScheduleAction } from "@/server/actions/schedules";

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
          <p className="text-[11px] text-ink/45">登録すると分類に応じたフォロータスクが自動作成されます（再分類時は未完了分を差し替え）。</p>
          <button type="submit" className="btn-accent">分類を登録</button>
        </form>
      </details>
    </Section>
  );
}
