"use server";

import { redirect } from "next/navigation";
import { getCompanyBySlug, getUserByLoginId, isCompanyOpen, labDb } from "@/lib/ai-lab/db";
import { hashPassword, verifyPassword } from "@/lib/ai-lab/password";
import { clearLabSession, labLoginPath, setLabSession } from "@/lib/ai-lab/session";

/**
 * AI Lab の受講者ログイン。
 *
 * 失敗時のメッセージは常に同一にして、ログインIDの存在有無を外から探れないようにする。
 * 同じ理由で、ユーザーが見つからない場合もダミーのハッシュ検証を1回走らせ、応答時間を揃える。
 */

const GENERIC_ERROR = "ログインIDまたはパスワードが正しくありません";
const LOCKED_ERROR = "ログインできません。時間をおいて再度お試しください";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// ユーザー不在時の時間合わせ用。実在しないパスワードに対する検証を1回行うためだけのもの。
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("dummy-password-for-timing");
  return dummyHashPromise;
}

function loginError(slug: string, message: string): never {
  redirect(`${labLoginPath(slug)}?error=${encodeURIComponent(message)}`);
}

export async function labSignIn(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "").trim();
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!slug) redirect("/");

  const company = await getCompanyBySlug(slug);
  if (!company || !isCompanyOpen(company)) {
    loginError(slug, "この環境は現在利用できません");
  }

  const user = await getUserByLoginId(company.id, loginId);

  // 実在しない/無効/プレビュー専用のいずれも、成功時と同じ処理時間で同じ文言を返す。
  if (!user || !user.is_active || user.is_preview) {
    await verifyPassword(password, await dummyHash());
    loginError(slug, GENERIC_ERROR);
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    loginError(slug, LOCKED_ERROR);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const attempts = (user.failed_attempts ?? 0) + 1;
    const patch: Record<string, unknown> = { failed_attempts: attempts };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
      patch.failed_attempts = 0; // ロック解除後に即再ロックされないようリセットする
    }
    await labDb().from("ai_lab_users").update(patch).eq("id", user.id);
    loginError(slug, attempts >= MAX_FAILED_ATTEMPTS ? LOCKED_ERROR : GENERIC_ERROR);
  }

  await labDb()
    .from("ai_lab_users")
    .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq("id", user.id);

  await setLabSession(user);
  redirect(`/lab/${slug}/chat`);
}

export async function labSignOut(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "").trim();
  await clearLabSession();
  redirect(slug ? labLoginPath(slug) : "/");
}
