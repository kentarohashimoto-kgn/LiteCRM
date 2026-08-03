"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientIp, logAudit } from "@/lib/audit-events";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/ai-lab/basic-auth";
import { LAB_MODELS } from "@/lib/ai-lab/models";
import { generatePassword, hashPassword } from "@/lib/ai-lab/password";
import type { IssuedLabUser } from "@/lib/ai-lab/ui-types";
import { validateAssetText, validateLoginId, validateSlug } from "@/lib/ai-lab/validate";

/**
 * AI Lab の管理操作(CRM側 /app/ai-lab)。
 *
 * 受講者向けの処理と違い、ここは CRM 管理者のセッションで動くので
 * service_role ではなく通常のクライアントを使う。テナント境界とロールは RLS 側でも効く(二重防御)。
 */

const MODEL_KEYS = LAB_MODELS.map((m) => m.key);

function backTo(path: string, saved: string): never {
  revalidatePath(path);
  redirect(`${path}?saved=${saved}`);
}
function failTo(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

function parseModels(formData: FormData): string[] {
  return formData
    .getAll("models")
    .map((v) => String(v))
    .filter((v) => MODEL_KEYS.includes(v as (typeof MODEL_KEYS)[number]));
}

function parseBudget(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function optionalText(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim();
  return s ? s : null;
}

// ===================== 会社 =====================

export async function createLabCompanyAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const list = "/app/ai-lab";

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const basicUser = String(formData.get("basicUser") ?? "").trim();
  const basicPassword = String(formData.get("basicPassword") ?? "");
  if (!name) failTo(list, "会社名を入力してください");
  const slugError = validateSlug(slug);
  if (slugError) failTo(list, slugError);
  if (!basicUser || !basicPassword) failTo(list, "Basic認証のIDとパスワードを入力してください");

  const models = parseModels(formData);
  if (models.length === 0) failTo(list, "利用可能なモデルを1つ以上選んでください");
  const defaultModel = String(formData.get("defaultModel") ?? models[0]);

  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("ai_lab_companies")
    .insert({
      tenant_id: ctx.tenantId,
      account_id: optionalText(formData.get("accountId")),
      name,
      slug,
      basic_user: basicUser,
      basic_secret_hash: await sha256Hex(basicPassword),
      allowed_models: models,
      default_model: models.includes(defaultModel) ? defaultModel : models[0],
      monthly_token_budget: parseBudget(formData.get("budget")),
      starts_on: optionalText(formData.get("startsOn")),
      ends_on: optionalText(formData.get("endsOn")),
      file_tools_enabled: String(formData.get("fileTools") ?? "") === "1",
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    failTo(list, error?.code === "23505" ? "このURL識別子は既に使われています" : "作成に失敗しました");
  }

  // 管理者プレビュー専用ユーザー。ログインフォームからは使えない(is_preview)。
  await sb.from("ai_lab_users").insert({
    tenant_id: ctx.tenantId,
    company_id: data.id,
    login_id: "__preview__",
    display_name: "プレビュー（管理者）",
    password_hash: await hashPassword(generatePassword(32)),
    is_preview: true,
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    email: ctx.email,
    action: "ai_lab.company.create",
    target: slug,
    ip: clientIp(),
  });

  backTo(`/app/ai-lab/${data.id}`, "created");
}

export async function updateLabCompanyAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const id = String(formData.get("id") ?? "");
  const path = `/app/ai-lab/${id}`;
  if (!id) failTo("/app/ai-lab", "会社が指定されていません");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) failTo(path, "会社名を入力してください");
  const models = parseModels(formData);
  if (models.length === 0) failTo(path, "利用可能なモデルを1つ以上選んでください");
  const defaultModel = String(formData.get("defaultModel") ?? models[0]);

  const patch: Record<string, unknown> = {
    name,
    account_id: optionalText(formData.get("accountId")),
    allowed_models: models,
    default_model: models.includes(defaultModel) ? defaultModel : models[0],
    monthly_token_budget: parseBudget(formData.get("budget")),
    starts_on: optionalText(formData.get("startsOn")),
    ends_on: optionalText(formData.get("endsOn")),
    // チェックボックスは未チェックだと値が来ないので、明示的に false を書き込む。
    file_tools_enabled: String(formData.get("fileTools") ?? "") === "1",
  };

  const basicUser = String(formData.get("basicUser") ?? "").trim();
  if (basicUser) patch.basic_user = basicUser;
  // パスワードは空欄なら据え置き(再入力を強制しない)。
  const basicPassword = String(formData.get("basicPassword") ?? "");
  if (basicPassword) patch.basic_secret_hash = await sha256Hex(basicPassword);

  const sb = getSupabaseServer();
  const { error } = await sb.from("ai_lab_companies").update(patch).eq("id", id);
  if (error) failTo(path, "保存に失敗しました");

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    email: ctx.email,
    action: "ai_lab.company.update",
    target: id,
    ip: clientIp(),
  });
  backTo(path, "saved");
}

export async function setLabCompanyActiveAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  const path = `/app/ai-lab/${id}`;

  const sb = getSupabaseServer();
  const { error } = await sb.from("ai_lab_companies").update({ is_active: active }).eq("id", id);
  if (error) failTo(path, "変更に失敗しました");

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    email: ctx.email,
    action: active ? "ai_lab.company.activate" : "ai_lab.company.deactivate",
    target: id,
    ip: clientIp(),
  });
  backTo(path, active ? "activated" : "deactivated");
}

// ===================== 受講者 =====================

/**
 * 受講者の一括発行。初期パスワードは戻り値でのみ平文を返し、DBにはハッシュしか残さない
 * (画面を閉じたら二度と見られないので、管理画面側でコピーを促す)。
 */
export async function issueLabUsersAction(input: {
  companyId: string;
  raw: string;
}): Promise<{ ok: boolean; error?: string; issued?: IssuedLabUser[] }> {
  const ctx = await requireAdminCtx();
  const sb = getSupabaseServer();

  const { data: company } = await sb
    .from("ai_lab_companies")
    .select("id")
    .eq("id", input.companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "会社が見つかりません" };

  // 1行1名。「ログインID,表示名」形式(表示名は省略可)。
  const lines = input.raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { ok: false, error: "発行する利用者を入力してください" };
  if (lines.length > 200) return { ok: false, error: "一度に発行できるのは200名までです" };

  const issued: IssuedLabUser[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const line of lines) {
    const [rawId, rawName] = line.split(/[,\t]/);
    const loginId = (rawId ?? "").trim();
    const err = validateLoginId(loginId);
    if (err) return { ok: false, error: `「${loginId || line}」: ${err}` };
    const displayName = (rawName ?? "").trim() || loginId;
    const password = generatePassword();
    issued.push({ loginId, displayName, password });
    rows.push({
      tenant_id: ctx.tenantId,
      company_id: input.companyId,
      login_id: loginId,
      display_name: displayName,
      password_hash: await hashPassword(password),
    });
  }

  const { error } = await sb.from("ai_lab_users").insert(rows);
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "同じログインIDが既に存在します" : "発行に失敗しました",
    };
  }

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    email: ctx.email,
    action: "ai_lab.users.issue",
    target: input.companyId,
    meta: { count: issued.length },
    ip: clientIp(),
  });
  revalidatePath(`/app/ai-lab/${input.companyId}/users`);
  return { ok: true, issued };
}

export async function resetLabUserPasswordAction(input: {
  userId: string;
  companyId: string;
}): Promise<{ ok: boolean; error?: string; password?: string }> {
  const ctx = await requireAdminCtx();
  const sb = getSupabaseServer();
  const password = generatePassword();
  const { error } = await sb
    .from("ai_lab_users")
    .update({ password_hash: await hashPassword(password), failed_attempts: 0, locked_until: null })
    .eq("id", input.userId)
    .eq("company_id", input.companyId);
  if (error) return { ok: false, error: "再発行に失敗しました" };

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    email: ctx.email,
    action: "ai_lab.user.reset_password",
    target: input.userId,
    ip: clientIp(),
  });
  revalidatePath(`/app/ai-lab/${input.companyId}/users`);
  return { ok: true, password };
}

export async function setLabUserActiveAction(formData: FormData): Promise<void> {
  await requireAdminCtx();
  const companyId = String(formData.get("companyId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  const path = `/app/ai-lab/${companyId}/users`;

  const sb = getSupabaseServer();
  const { error } = await sb
    .from("ai_lab_users")
    .update({ is_active: active })
    .eq("id", userId)
    .eq("company_id", companyId);
  if (error) failTo(path, "変更に失敗しました");
  backTo(path, active ? "user_activated" : "user_deactivated");
}

export async function unlockLabUserAction(formData: FormData): Promise<void> {
  await requireAdminCtx();
  const companyId = String(formData.get("companyId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const path = `/app/ai-lab/${companyId}/users`;

  const sb = getSupabaseServer();
  const { error } = await sb
    .from("ai_lab_users")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", userId)
    .eq("company_id", companyId);
  if (error) failTo(path, "解除に失敗しました");
  backTo(path, "unlocked");
}

// ===================== プリセット・アセット =====================

export async function savePresetAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const companyId = String(formData.get("companyId") ?? "");
  const id = String(formData.get("id") ?? "");
  const path = `/app/ai-lab/${companyId}/presets`;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) failTo(path, "プリセット名を入力してください");
  const modelKeyRaw = String(formData.get("modelKey") ?? "").trim();
  const modelKey = MODEL_KEYS.includes(modelKeyRaw as (typeof MODEL_KEYS)[number]) ? modelKeyRaw : null;

  const patch = {
    name,
    description: optionalText(formData.get("description")),
    system_prompt: String(formData.get("systemPrompt") ?? ""),
    model_key: modelKey,
    sort_order: Number(formData.get("sortOrder") ?? 0) || 0,
    is_active: String(formData.get("isActive") ?? "") === "1",
  };

  const sb = getSupabaseServer();
  const { error } = id
    ? await sb.from("ai_lab_presets").update(patch).eq("id", id).eq("company_id", companyId)
    : await sb.from("ai_lab_presets").insert({ ...patch, tenant_id: ctx.tenantId, company_id: companyId });
  if (error) failTo(path, "保存に失敗しました");

  backTo(path, id ? "preset_saved" : "preset_created");
}

export async function deletePresetAction(formData: FormData): Promise<void> {
  await requireAdminCtx();
  const companyId = String(formData.get("companyId") ?? "");
  const id = String(formData.get("id") ?? "");
  const path = `/app/ai-lab/${companyId}/presets`;

  const sb = getSupabaseServer();
  const { error } = await sb.from("ai_lab_presets").delete().eq("id", id).eq("company_id", companyId);
  if (error) failTo(path, "削除に失敗しました");
  backTo(path, "preset_deleted");
}

/** アセットはテキスト貼付、または .txt / .md のアップロードで登録する。 */
export async function saveAssetAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const companyId = String(formData.get("companyId") ?? "");
  const presetId = String(formData.get("presetId") ?? "");
  const path = `/app/ai-lab/${companyId}/presets`;

  let text = String(formData.get("text") ?? "");
  let fileName = String(formData.get("fileName") ?? "").trim();

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (!/\.(txt|md|markdown|csv)$/i.test(file.name)) {
      failTo(path, "テキスト・Markdown(.txt / .md / .csv)のみ登録できます");
    }
    text = await file.text();
    if (!fileName) fileName = file.name;
  }
  if (!fileName) fileName = "参考資料";

  const err = validateAssetText(text);
  if (err) failTo(path, err);

  const sb = getSupabaseServer();
  const { error } = await sb.from("ai_lab_assets").insert({
    tenant_id: ctx.tenantId,
    company_id: companyId,
    preset_id: presetId,
    file_name: fileName,
    mime: "text/plain",
    size_bytes: text.length,
    extracted_text: text,
  });
  if (error) failTo(path, "登録に失敗しました");
  backTo(path, "asset_saved");
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  await requireAdminCtx();
  const companyId = String(formData.get("companyId") ?? "");
  const id = String(formData.get("id") ?? "");
  const path = `/app/ai-lab/${companyId}/presets`;

  const sb = getSupabaseServer();
  const { error } = await sb.from("ai_lab_assets").delete().eq("id", id).eq("company_id", companyId);
  if (error) failTo(path, "削除に失敗しました");
  backTo(path, "asset_deleted");
}

// ===================== プレビュー =====================

/** 60秒・1回限りのプレビューリンクを発行する(Basic認証は別途必要)。 */
export async function createPreviewLinkAction(input: {
  companyId: string;
}): Promise<{ ok: boolean; error?: string; path?: string }> {
  const ctx = await requireAdminCtx();
  const sb = getSupabaseServer();

  const { data: company } = await sb
    .from("ai_lab_companies")
    .select("id, slug")
    .eq("id", input.companyId)
    .maybeSingle();
  if (!company) return { ok: false, error: "会社が見つかりません" };

  const token = randomBytes(24).toString("hex");
  const { error } = await sb.from("ai_lab_preview_tokens").insert({
    token,
    tenant_id: ctx.tenantId,
    company_id: input.companyId,
    created_by: ctx.userId,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  if (error) return { ok: false, error: "発行に失敗しました" };

  return { ok: true, path: `/lab/${company.slug}/preview?token=${token}` };
}
