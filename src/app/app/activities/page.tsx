import Link from "next/link";
import { getCtx } from "@/lib/session";
import { getAccount, getUser, listActivities } from "@/lib/data/store";
import { PageHeader, Avatar } from "@/components/ui/primitives";
import { ACTIVITY_TYPE_MAP } from "@/lib/constants";
import { formatDateFull } from "@/lib/utils";

export default function ActivitiesPage() {
  const ctx = getCtx();
  const activities = listActivities(ctx);

  return (
    <div>
      <PageHeader title="活動履歴" subtitle="商談・顧客に紐づく活動(商談・電話・メール・DM等)の記録です。" />
      <div className="card card-pad">
        {activities.length === 0 ? (
          <p className="text-sm text-ink/40 py-8 text-center">活動履歴がありません</p>
        ) : (
          <ul className="space-y-4">
            {activities.slice(0, 80).map((a) => (
              <li key={a.id} className="flex gap-3">
                <Avatar user={getUser(a.owner_user_id)} size={28} />
                <div className="min-w-0 flex-1 border-b border-black/[0.04] pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="pill bg-teal-light text-teal-deep">{ACTIVITY_TYPE_MAP[a.activity_type]?.label}</span>
                    <span className="text-sm font-medium text-ink">{a.title}</span>
                    {a.opportunity_id && (
                      <Link href={`/app/opportunities/${a.opportunity_id}`} className="text-xs text-teal-deep hover:underline">商談を見る</Link>
                    )}
                  </div>
                  {a.body && <p className="text-sm text-ink/60 mt-1">{a.body}</p>}
                  <div className="text-xs text-ink/40 mt-1">
                    {formatDateFull(a.activity_at)} ・ {getUser(a.owner_user_id)?.name}
                    {a.account_id && ` ・ ${getAccount(a.account_id)?.name ?? ""}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
