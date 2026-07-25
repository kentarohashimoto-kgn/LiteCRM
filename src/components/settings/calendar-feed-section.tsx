import { CalendarDays, CheckCircle2, AlertTriangle } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTimeJst } from "@/lib/utils";
import {
  disconnectCalendarFeedAction,
  getCalendarFeedStatus,
  saveCalendarFeedAction,
} from "@/server/actions/calendar-feed";

/**
 * Googleカレンダー連携(非公開URL)の設定。
 * OAuthと違い Google Cloud Console の作業が不要で、URLを貼るだけで連携できる。
 * マインドマップの週次自動生成で予定を取り込むために使う。
 */
export async function CalendarFeedSection({ message, ok }: { message?: string; ok?: boolean }) {
  const status = await getCalendarFeedStatus();

  return (
    <Section title="Googleカレンダー連携" icon={<CalendarDays size={15} />} className="mb-5">
      {message && (
        <p
          className={`text-xs rounded-lg px-3 py-2 mb-3 ${
            ok ? "text-emerald-700 bg-emerald-50" : "text-rose-600 bg-rose-50"
          }`}
        >
          {message}
        </p>
      )}

      <p className="text-xs text-ink/60 mb-3">
        カレンダーの予定を <strong>マインドマップの週次予定</strong> に取り込みます。
        Googleカレンダーの <strong>非公開URL(iCal形式)</strong> を貼るだけで連携できます（Google側の管理者設定は不要）。
      </p>

      <ol className="text-xs text-ink/60 mb-4 space-y-1 list-decimal list-inside bg-mist-soft rounded-xl p-3">
        <li>Googleカレンダーを開き、左のカレンダー名の「︙」→ <strong>設定と共有</strong></li>
        <li>下へスクロールして <strong>カレンダーの統合</strong></li>
        <li>
          <strong>非公開URL（iCal形式）</strong> の値をコピー（<code>.../private-xxxxx/basic.ics</code>）
        </li>
        <li>下の欄に貼って「連携する」</li>
      </ol>

      {status.connected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <span className="font-semibold text-ink">連携済み</span>
            <code className="text-[11px] text-ink/50 break-all">{status.masked}</code>
          </div>
          <div className="text-xs text-ink/50">
            {status.lastSyncedAt && <>最終取得 {formatDateTimeJst(status.lastSyncedAt)}</>}
            {status.lastEventCount != null && <> / 直近の取得 {status.lastEventCount}件</>}
          </div>
          {status.lastError && (
            <div className="flex items-start gap-1.5 text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{status.lastError}</span>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <form action={saveCalendarFeedAction} className="flex flex-1 min-w-[260px] items-end gap-2">
              <div className="flex-1">
                <label className="label" htmlFor="ics_url_re">
                  URLを貼り替える
                </label>
                <input
                  id="ics_url_re"
                  name="ics_url"
                  type="url"
                  className="input"
                  placeholder="https://calendar.google.com/calendar/ical/.../private-xxxx/basic.ics"
                  required
                />
              </div>
              <SubmitButton className="btn-ghost" pendingLabel="確認中…">
                更新
              </SubmitButton>
            </form>
            <form action={disconnectCalendarFeedAction}>
              <SubmitButton className="btn-ghost text-rose-600" pendingLabel="解除中…">
                連携解除
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <form action={saveCalendarFeedAction} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[280px]">
            <label className="label" htmlFor="ics_url">
              非公開URL（iCal形式）
            </label>
            <input
              id="ics_url"
              name="ics_url"
              type="url"
              className="input"
              placeholder="https://calendar.google.com/calendar/ical/.../private-xxxx/basic.ics"
              required
            />
          </div>
          <SubmitButton className="btn-primary" pendingLabel="接続を確認中…">
            連携する
          </SubmitButton>
        </form>
      )}

      <p className="text-[11px] text-ink/40 mt-3">
        このURLは知っている人がカレンダーを読める鍵です。暗号化して保存し、本人以外は参照できません。
        漏れた場合はGoogleカレンダー側で「URLをリセット」してから貼り直してください。
      </p>
    </Section>
  );
}
