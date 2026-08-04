import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signLabToken, verifyLabToken } from "./token";
import { getCompanyBySlug, getUserById, isCompanyOpen, type LabCompanyRow, type LabUserRow } from "./db";
import { availableModelsFor, resolveDefaultModel, type LabModel, type ModelKey } from "./models";

/**
 * 受講者セッション。CRM(Supabase Auth)とは完全に別系統で、
 * Cookie に載るのは「受講者ID + 会社ID + 有効期限」を署名したトークンだけ。
 */

export const LAB_COOKIE = "ailab_session";
export const LAB_SESSION_HOURS = 12;

/**
 * セッション署名鍵。
 * 専用の AILAB_SESSION_SECRET を推奨するが、未設定でも動くように
 * サーバー専用の既存シークレット(service role key)から用途を分けて派生させる。
 * 環境変数の設定漏れで「誰もログインできない」状態になるのを避けるための実務上の妥協で、
 * service role key を差し替えると既存セッションが失効する点だけ許容している。
 */
function sessionSecret(): string {
  const explicit = process.env.AILAB_SESSION_SECRET;
  if (explicit) return explicit;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return derived ? `ailab-session-v1:${derived}` : "";
}

export interface LabCtx {
  user: LabUserRow;
  company: LabCompanyRow;
  /** 受講者が実際に選べるモデル(会社の許可 ∩ APIキーが揃っているもの)。 */
  models: LabModel[];
  defaultModel: ModelKey | null;
}

export function labLoginPath(slug: string): string {
  return `/lab/${slug}/login`;
}

export async function setLabSession(user: Pick<LabUserRow, "id" | "company_id">): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + LAB_SESSION_HOURS * 3600;
  const token = await signLabToken({ uid: user.id, cid: user.company_id, exp }, sessionSecret());
  (await cookies()).set(LAB_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LAB_SESSION_HOURS * 3600,
  });
}

export async function clearLabSession(): Promise<void> {
  (await cookies()).set(LAB_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * Cookie からコンテキストを復元する。以下のいずれかに当たれば null(＝未ログイン扱い)。
 *   - 署名不正 / 期限切れ
 *   - URLのスラッグが指す会社と、トークンの会社IDが違う（他社URLでの使い回し）
 *   - 会社または受講者が無効化・期間外
 */
export const getLabCtx = cache(async (slug: string): Promise<LabCtx | null> => {
  const secret = sessionSecret();
  if (!secret) return null;

  const token = (await cookies()).get(LAB_COOKIE)?.value;
  const payload = await verifyLabToken(token, secret);
  if (!payload) return null;

  const company = await getCompanyBySlug(slug);
  if (!company || company.id !== payload.cid || !isCompanyOpen(company)) return null;

  const user = await getUserById(payload.uid);
  if (!user || user.company_id !== company.id || !user.is_active) return null;

  const models = availableModelsFor(company.allowed_models);
  return {
    user,
    company,
    models,
    defaultModel: resolveDefaultModel(company.allowed_models, company.default_model),
  };
});

/** ページ側で使う。未ログインならログイン画面へ。 */
export async function requireLabCtx(slug: string): Promise<LabCtx> {
  const ctx = await getLabCtx(slug);
  if (!ctx) redirect(labLoginPath(slug));
  return ctx;
}
