import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ActionNotice } from "@/components/ui/action-notice";
import { EmptyState, PageHeader, Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompanyTabs } from "@/components/ai-lab/admin/company-tabs";
import { IssueUsersForm, ResetPasswordButton } from "@/components/ai-lab/admin/user-admin";
import { setLabUserActiveAction, unlockLabUserAction } from "@/server/actions/ai-lab-admin";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface LabUser {
  id: string;
  login_id: string;
  display_name: string;
  is_active: boolean;
  locked_until: string | null;
  last_login_at: string | null;
}

export default async function AiLabUsersPage(
  props: {
    params: Promise<{ companyId: string }>;
    searchParams: Promise<{ saved?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  await requireAdminCtx();
  const sb = getSupabaseServer();

  const [{ data: company }, usersR] = await Promise.all([
    sb.from("ai_lab_companies").select("id, name, slug").eq("id", params.companyId).maybeSingle(),
    sb
      .from("ai_lab_users")
      .select("id, login_id, display_name, is_active, locked_until, last_login_at")
      .eq("company_id", params.companyId)
      .eq("is_preview", false)
      .order("created_at", { ascending: true }),
  ]);
  if (!company) notFound();
  const users = (usersR.data ?? []) as LabUser[];
  const now = Date.now();

  return (
    <div>
      <PageHeader title={company.name as string} subtitle="受講者アカウントの発行・管理" />
      <CompanyTabs companyId={params.companyId} active="users" />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          user_activated: "受講者を有効にしました。",
          user_deactivated: "受講者を無効にしました。ログインできなくなります。",
          unlocked: "ロックを解除しました。",
        }}
      />

      <Section title="受講者を発行" icon={<Users size={14} />} className="mb-6">
        <IssueUsersForm companyId={params.companyId} slug={company.slug as string} />
      </Section>

      <Section title={`受講者一覧（${users.length}名）`}>
        {users.length === 0 ? (
          <EmptyState message="まだ受講者がいません。上のフォームから発行してください。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">表示名</th>
                  <th className="th">ログインID</th>
                  <th className="th">状態</th>
                  <th className="th">最終ログイン</th>
                  <th className="th">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const locked = Boolean(u.locked_until && new Date(u.locked_until).getTime() > now);
                  return (
                    <tr key={u.id} className="row-hover border-t border-black/[0.04]">
                      <td className="td">{u.display_name}</td>
                      <td className="td font-mono text-xs">{u.login_id}</td>
                      <td className="td">
                        {!u.is_active ? (
                          <span className="pill bg-ink/10 text-ink/55">無効</span>
                        ) : locked ? (
                          <span className="pill bg-amber-100 text-amber-700">ロック中</span>
                        ) : (
                          <span className="pill bg-emerald-100 text-emerald-700">有効</span>
                        )}
                      </td>
                      <td className="td text-xs text-ink/60">
                        {u.last_login_at ? formatDateTimeJst(u.last_login_at) : "—"}
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-3">
                          <ResetPasswordButton userId={u.id} companyId={params.companyId} />
                          {locked && (
                            <form action={unlockLabUserAction}>
                              <input type="hidden" name="companyId" value={params.companyId} />
                              <input type="hidden" name="userId" value={u.id} />
                              <SubmitButton
                                className="text-xs font-semibold text-ink/50 hover:text-teal-deep"
                                pendingLabel="解除中…"
                              >
                                ロック解除
                              </SubmitButton>
                            </form>
                          )}
                          <form action={setLabUserActiveAction}>
                            <input type="hidden" name="companyId" value={params.companyId} />
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="active" value={u.is_active ? "0" : "1"} />
                            <SubmitButton
                              className="text-xs font-semibold text-ink/50 hover:text-rose-600"
                              pendingLabel="変更中…"
                            >
                              {u.is_active ? "無効化" : "有効化"}
                            </SubmitButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
