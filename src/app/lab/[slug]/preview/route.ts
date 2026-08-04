import { NextResponse, type NextRequest } from "next/server";
import { getCompanyBySlug, getPreviewUser, isCompanyOpen, labDb } from "@/lib/ai-lab/db";
import { setLabSession } from "@/lib/ai-lab/session";

/**
 * 管理者プレビューの受け口。
 * 管理画面が発行した60秒・1回限りのトークンと引き換えに、プレビュー用ユーザーのセッションを発行する。
 *
 * Basic 認証は middleware で通常どおり要求される(このトークンで回避はできない)。
 * トークン1枚でゲートを2つ抜けられる状態を作らないための意図的な設計。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  const token = req.nextUrl.searchParams.get("token");
  const deny = () => new NextResponse("Not Found", { status: 404 });
  if (!token) return deny();

  const company = await getCompanyBySlug(params.slug);
  if (!company || !isCompanyOpen(company)) return deny();

  const db = labDb();
  const { data: row } = await db
    .from("ai_lab_preview_tokens")
    .select("token, company_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (!row || row.company_id !== company.id) return deny();
  if (row.used_at) return deny();
  if (new Date(row.expires_at as string) <= new Date()) return deny();

  // 使用済みにしてから発行する(同じリンクの二度使いを防ぐ)。
  const { data: claimed } = await db
    .from("ai_lab_preview_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token)
    .is("used_at", null)
    .select("token")
    .maybeSingle();
  if (!claimed) return deny();

  const previewUser = await getPreviewUser(company.id);
  if (!previewUser) return deny();

  await setLabSession(previewUser);
  return NextResponse.redirect(new URL(`/lab/${params.slug}/chat`, req.nextUrl.origin));
}
