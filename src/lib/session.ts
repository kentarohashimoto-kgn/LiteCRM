/**
 * セッション / 認証コンテキスト。
 *
 * デモモードでは Cookie に保存した user_id からログインユーザーを決定し、
 * memberships からロールを引く(ログイン画面でユーザーを選択)。
 * Supabase化時は supabase.auth.getUser() に置き換える。
 */

import { cookies } from "next/headers";
import { TENANT_ID } from "@/lib/data/seed";
import { getMemberships, getUser } from "@/lib/data/store";
import type { Ctx } from "@/lib/data/store";
import type { Role, User } from "@/lib/types";

export const SESSION_COOKIE = "sos_user";
const DEFAULT_USER_ID = "u-daihyo";

export function getSessionUserId(): string {
  return cookies().get(SESSION_COOKIE)?.value ?? DEFAULT_USER_ID;
}

export function getCtx(): Ctx {
  const userId = getSessionUserId();
  const memberships = getMembershipsForTenant();
  const m = memberships.find((x) => x.user_id === userId);
  const role: Role = m?.role ?? "viewer";
  return { userId, role, tenantId: TENANT_ID };
}

function getMembershipsForTenant() {
  return getMemberships({ userId: "", role: "owner", tenantId: TENANT_ID });
}

export function getCurrentUser(): User | undefined {
  return getUser(getSessionUserId());
}

export function isAuthenticated(): boolean {
  return Boolean(cookies().get(SESSION_COOKIE)?.value);
}
