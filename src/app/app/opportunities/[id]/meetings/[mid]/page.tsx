import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { getMeeting, getOpportunity } from "@/lib/data/select";
import { Card, PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { updateMeetingAction } from "@/server/actions";
import { formatDateFull } from "@/lib/utils";

export default async function MeetingDetailPage({ params }: { params: { id: string; mid: string } }) {
  const ws = await getWorkspace();
  const meeting = getMeeting(ws, params.mid);
  if (!meeting || meeting.opportunity_id !== params.id) notFound();
  const opp = getOpportunity(ws, params.id);

  return (
    <div className="max-w-3xl">
      <Link href={`/app/opportunities/${params.id}`} className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 案件へ戻る
      </Link>
      <PageHeader title={meeting.title} subtitle={`${meeting.account?.name ?? ""}｜案件: ${opp?.name ?? "—"}`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">商談日</div><div className="text-lg font-bold mt-1">{formatDateFull(meeting.meeting_date)}</div></Card>
        <Card><div className="text-xs text-ink/50">形式</div><div className="text-lg font-bold mt-1">{meeting.method ?? "—"}</div></Card>
        <Card><div className="text-xs text-ink/50">担当</div><div className="mt-1 flex items-center gap-1.5"><Avatar user={meeting.owner} size={22} /><span className="text-sm font-medium">{meeting.owner?.name ?? "—"}</span></div></Card>
        <Card><div className="text-xs text-ink/50">次アクション</div><div className="text-sm font-bold mt-1">{formatDateFull(meeting.next_action_date)}</div></Card>
      </div>

      {meeting.summary && (
        <Section title="議事・要点" className="mb-5">
          <p className="text-sm text-ink/80 whitespace-pre-wrap">{meeting.summary}</p>
        </Section>
      )}

      <Section title="商談を編集">
        <form action={updateMeetingAction} className="space-y-4">
          <input type="hidden" name="id" value={meeting.id} />
          <input type="hidden" name="opportunity_id" value={meeting.opportunity_id} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">タイトル</label>
              <input name="title" defaultValue={meeting.title} className="input" placeholder="例：初回商談 / 2回目 提案" />
            </div>
            <div>
              <label className="label">商談日</label>
              <input name="meeting_date" type="date" defaultValue={meeting.meeting_date ?? ""} className="input" />
            </div>
          </div>
          <div>
            <label className="label">形式</label>
            <select name="method" defaultValue={meeting.method ?? ""} className="input">
              <option value="">—</option>
              <option value="訪問">訪問</option>
              <option value="オンライン">オンライン</option>
              <option value="電話">電話</option>
              <option value="その他">その他</option>
            </select>
          </div>
          <div>
            <label className="label">議事・要点</label>
            <textarea name="summary" rows={5} defaultValue={meeting.summary ?? ""} className="input" placeholder="課題・予算・決裁者・反応・次の打ち手など" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">次アクション日</label>
              <input name="next_action_date" type="date" defaultValue={meeting.next_action_date ?? ""} className="input" />
            </div>
            <div>
              <label className="label">次アクション内容</label>
              <input name="next_action_text" defaultValue={meeting.next_action_text ?? ""} className="input" />
            </div>
          </div>
          <button type="submit" className="btn-primary">保存する</button>
        </form>
      </Section>
    </div>
  );
}
