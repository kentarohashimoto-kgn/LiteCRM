import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Flag, Link2, MessageSquare, PenLine } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { getBusinessCard, getCardComments, getUserTagOptions } from "@/lib/data/business-cards";
import { CardEditForm } from "@/components/business-cards/card-edit-form";
import { CardComments } from "@/components/business-cards/card-comments";
import { CardPrioritySelect } from "@/components/business-cards/card-priority-select";
import { CardTagsEditor } from "@/components/business-cards/card-tags-editor";
import { CardLinkCell } from "@/components/business-cards/card-link-cell";
import { ChangeHistory } from "@/components/history/change-history";
import { RecordRecent } from "@/components/layout/recent-items";

export const dynamic = "force-dynamic";

/**
 * 名刺詳細: スキャン誤りの修正（編集）・コメント・優先度/任意タグ・CRM連携をまとめて扱う。
 */
export default async function BusinessCardDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx();
  const card = await getBusinessCard(params.id);
  if (!card) notFound();

  const sb = getSupabaseServer();
  const [comments, tagOptions, profilesR] = await Promise.all([
    getCardComments(card.id),
    getUserTagOptions(),
    sb.from("profiles").select("id, display_name"),
  ]);
  const nameById: Record<string, string> = {};
  for (const p of profilesR.data ?? []) nameById[p.id as string] = (p.display_name as string) ?? "—";
  const canModerate = ctx.role === "owner" || ctx.role === "admin";
  const displayName = card.full_name || card.company_name || "名刺";

  return (
    <div>
      <RecordRecent href={`/app/business-cards/${card.id}`} label={displayName} kind="名刺" />
      <Link href="/app/business-cards" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 名刺情報一覧
      </Link>
      <PageHeader
        title={displayName}
        subtitle={[card.company_name, card.department, card.title].filter(Boolean).join(" ・ ")}
        action={
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-ink/50">優先度</span>
            <CardPrioritySelect cardId={card.id} priority={card.priority ?? null} />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Section title="名刺情報の編集" icon={<PenLine size={15} />} action={<span className="text-[11px] text-ink/40">スキャン誤りはここで修正</span>}>
            <CardEditForm card={card} />
          </Section>

          <Section title={`コメント（${comments.length}）`} icon={<MessageSquare size={15} />}>
            <CardComments
              cardId={card.id}
              comments={comments}
              nameById={nameById}
              currentUserId={ctx.userId}
              canModerate={canModerate}
            />
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="アクションタグ" icon={<Flag size={15} />} action={<span className="text-[11px] text-ink/40">あとで対応する名刺の目印</span>}>
            <CardTagsEditor cardId={card.id} tags={card.user_tags ?? []} suggestions={tagOptions} />
          </Section>

          <Section title="CRM連携" icon={<Link2 size={15} />}>
            <CardLinkCell
              cardId={card.id}
              accountId={card.account_id ?? null}
              accountName={card.accounts?.name ?? null}
              contactName={card.contacts?.name ?? null}
              matchType={card.match_type ?? null}
            />
          </Section>

          <Section title="取込情報">
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between gap-2"><dt className="text-ink/50">交換者</dt><dd>{nameById[card.owner_user_id] ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink/50">名刺交換日</dt><dd>{card.exchanged_on ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink/50">取込元</dt><dd>{card.source === "eight" ? "Eight" : card.source}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink/50">Eightでつながり</dt><dd>{card.eight_connected ? "あり" : "—"}</dd></div>
              {card.rank && <div className="flex justify-between gap-2"><dt className="text-ink/50">ランク</dt><dd>{card.rank}</dd></div>}
            </dl>
            {card.tags.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-ink/50 mb-1">イベントタグ（取込時）</div>
                <div className="flex flex-wrap gap-1">
                  {card.tags.map((t) => <span key={t} className="pill text-[10px]">{t}</span>)}
                </div>
              </div>
            )}
          </Section>

          <ChangeHistory table="business_cards" recordId={card.id} />
        </div>
      </div>
    </div>
  );
}
