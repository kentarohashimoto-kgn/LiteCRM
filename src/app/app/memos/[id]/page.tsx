import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CornerDownRight, Link2, Mic, Plus, Trash2, ExternalLink } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getMemoPage, listLinkableMeetings, listLinkableOpportunities } from "@/lib/data/memos";
import { listMemoPageRecordings } from "@/lib/data/recordings";
import { MEMO_KIND_LABEL } from "@/lib/memo";
import { Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { MemoEditor } from "@/components/memos/memo-editor";
import { MeetingRecorder } from "@/components/meetings/meeting-recorder";
import { createMemoPageAction, deleteMemoPageAction, linkMemoPageAction } from "@/server/actions/memos";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * メモ・議事録ページの編集画面（Notionライク）。
 * ・タイトル/本文は自動保存
 * ・議事録は録音（既存の商談録音パイプラインを再利用。夜間に文字起こし→本文が空ならページへ反映）
 * ・後からCRMの案件・商談に紐付け（ページ配下の録音にも伝播）
 * ・サブページで自由に階層化
 */
export default async function MemoPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireCtx();
  const page = await getMemoPage(params.id);
  if (!page) notFound();

  const [recordings, oppOptions, meetingOptions] = await Promise.all([
    listMemoPageRecordings(page.id),
    listLinkableOpportunities(page.opportunity?.id ?? null),
    page.opportunity ? listLinkableMeetings(page.opportunity.id) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-5xl">
      {/* パンくず */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-ink/50">
        <Link href="/app/memos" className="inline-flex items-center gap-0.5 hover:text-teal-deep">
          <ChevronLeft size={13} /> メモ・議事録
        </Link>
        {page.parent && (
          <>
            <span>/</span>
            <Link href={`/app/memos/${page.parent.id}`} className="hover:text-teal-deep">
              {page.parent.title}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-ink/70">{page.title || "無題"}</span>
        <span className={`pill ml-1 ${page.kind === "minutes" ? "bg-teal-light text-teal-deep" : "bg-mist-soft text-ink/60"}`}>
          {MEMO_KIND_LABEL[page.kind]}
        </span>
        <span className="ml-auto tabular-nums">更新 {formatDateTimeJst(page.updated_at)}</span>
      </div>

      {searchParams.error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">{searchParams.error}</div>
      )}

      {/* 本文エディタ（自動保存） */}
      <div className="card card-pad mb-5">
        <MemoEditor pageId={page.id} kind={page.kind} initialTitle={page.title} initialBody={page.body} />
      </div>

      {/* 録音（議事録の自動取得） */}
      <Section
        title="録音で議事録を取る"
        icon={<Mic size={15} />}
        className="mb-5"
      >
        <p className="text-xs text-ink/50 mb-3">
          録音を保存すると夜間に自動で文字起こし・AI要約され、このページの本文が空なら結果が反映されます。
          案件・商談に紐付け済みの場合は商談側にも共有されます。
        </p>
        <MeetingRecorder
          memoPageId={page.id}
          opportunityId={page.opportunity?.id ?? null}
          meetingId={page.meeting?.id ?? null}
          accountId={page.opportunity?.account_id ?? null}
          defaultTitle={page.title || "議事録"}
          recordings={recordings}
        />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* CRM紐付け */}
        <Section title="CRMに紐付け（案件・商談）" icon={<Link2 size={15} />}>
          {page.opportunity ? (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="pill bg-amber-50 text-accent-orange">案件</span>
              <Link href={`/app/opportunities/${page.opportunity.id}`} className="font-semibold text-teal-deep hover:underline inline-flex items-center gap-1">
                {page.opportunity.name} <ExternalLink size={11} />
              </Link>
              {page.meeting && (
                <>
                  <span className="pill bg-teal-light text-teal-deep">商談</span>
                  <Link
                    href={`/app/opportunities/${page.opportunity.id}/meetings/${page.meeting.id}`}
                    className="font-semibold text-teal-deep hover:underline inline-flex items-center gap-1"
                  >
                    {page.meeting.meeting_date ? `${String(page.meeting.meeting_date).slice(0, 10)} ` : ""}
                    {page.meeting.title} <ExternalLink size={11} />
                  </Link>
                </>
              )}
            </div>
          ) : (
            <p className="mb-3 text-xs text-ink/50">まだ紐付けられていません。後からいつでも紐付けできます。</p>
          )}
          <form action={linkMemoPageAction} className="space-y-2">
            <input type="hidden" name="id" value={page.id} />
            <div>
              <label className="label" htmlFor="opportunity_id">案件</label>
              <select id="opportunity_id" name="opportunity_id" className="input" defaultValue={page.opportunity?.id ?? ""}>
                <option value="">（紐付けない）</option>
                {oppOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            {page.opportunity && (
              <div>
                <label className="label" htmlFor="meeting_id">商談（任意・案件配下から選択）</label>
                <select id="meeting_id" name="meeting_id" className="input" defaultValue={page.meeting?.id ?? ""}>
                  <option value="">（紐付けない）</option>
                  {meetingOptions.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            <SubmitButton className="btn-ghost" pendingLabel="保存中…">紐付けを保存</SubmitButton>
            {!page.opportunity && (
              <p className="text-[11px] text-ink/40">案件を保存すると、その案件の商談も選べるようになります。</p>
            )}
          </form>
        </Section>

        {/* サブページ */}
        <Section title="サブページ" icon={<CornerDownRight size={15} />}>
          {page.children.length === 0 ? (
            <p className="mb-3 text-xs text-ink/50">このページの下に自由にページを増やせます。</p>
          ) : (
            <ul className="mb-3 space-y-1.5">
              {page.children.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/memos/${c.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-mist-soft text-sm">
                    <CornerDownRight size={13} className="text-ink/35" />
                    <span className="font-medium text-ink">{c.title}</span>
                    <span className={`pill text-[10px] ${c.kind === "minutes" ? "bg-teal-light text-teal-deep" : "bg-mist-soft text-ink/60"}`}>
                      {MEMO_KIND_LABEL[c.kind]}
                    </span>
                    <span className="ml-auto text-[11px] text-ink/35 tabular-nums">{formatDateTimeJst(c.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <form action={createMemoPageAction}>
              <input type="hidden" name="kind" value="memo" />
              <input type="hidden" name="parent_id" value={page.id} />
              <SubmitButton className="btn-ghost" pendingLabel="作成中…">
                <Plus size={14} /> サブページ（メモ）
              </SubmitButton>
            </form>
            <form action={createMemoPageAction}>
              <input type="hidden" name="kind" value="minutes" />
              <input type="hidden" name="parent_id" value={page.id} />
              <SubmitButton className="btn-ghost" pendingLabel="作成中…">
                <Mic size={14} /> サブページ（議事録）
              </SubmitButton>
            </form>
          </div>
        </Section>
      </div>

      {/* 削除 */}
      <div className="mt-6 flex justify-end">
        <form action={deleteMemoPageAction}>
          <input type="hidden" name="id" value={page.id} />
          <SubmitButton className="btn-ghost !text-red-600" pendingLabel="削除中…" title="このページと録音を削除（サブページは残ります）">
            <Trash2 size={14} /> ページを削除
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
