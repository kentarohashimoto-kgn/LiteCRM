import { Plus } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { ActivitiesPaginatedList } from "@/components/activities/activities-paginated-list";
import { fetchActivitiesPageAction } from "@/server/actions/activities";

export const dynamic = "force-dynamic";

/**
 * 活動履歴(E-1軽量化済み): 従来の workspace_full(2.1MB)全件ロードをやめ、
 * サーバーページング(activities_page RPC)＋無限スクロールに変更。
 */
export default async function ActivitiesPage() {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  const first = await fetchActivitiesPageAction({ filter: {}, offset: 0, limit: 50 });

  return (
    <div>
      <PageHeader
        title="活動履歴"
        subtitle="案件・顧客に紐づく活動(商談・電話・メール・DM等)の記録です。"
        action={
          <LinkButton href="/app/activities/new" variant="accent">
            <Plus size={16} /> 活動を登録
          </LinkButton>
        }
      />
      <ActivitiesPaginatedList initialRows={first.rows} initialTotal={first.total} owners={members} />
    </div>
  );
}
