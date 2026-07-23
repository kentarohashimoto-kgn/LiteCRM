import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { secureCompare } from "@/lib/secure-compare";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getChatCredentials, getChatAccessToken } from "@/lib/chat/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 【一時診断】Google Workspace アドオンのデプロイ/インストール状態を照会。
 * P2の対話イベントが1件も届かない原因（デプロイ未インストール等）を特定するため、
 * サービスアカウントで gsuiteaddons API を叩いて実状を返す。原因特定後に除去する。
 * 認可: CRON_SECRET（Authorization: Bearer または ?token=）。結果はchat_event_logにも保存。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  const authed =
    !!secret &&
    (secureCompare(req.headers.get("authorization"), `Bearer ${secret}`) ||
      secureCompare(queryToken, secret));
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const creds = getChatCredentials();
  const out: Record<string, unknown> = {};
  out.saPresent = !!creds;
  const clientEmail = creds?.client_email ?? null;
  out.clientEmail = clientEmail;
  // client_email: name@PROJECT_ID.iam.gserviceaccount.com
  const emailProject = clientEmail?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? null;
  out.emailProject = emailProject;

  const token = await getChatAccessToken("https://www.googleapis.com/auth/cloud-platform");
  out.gotCloudPlatformToken = !!token;
  if (!token) return NextResponse.json(out);

  const projects = Array.from(new Set([emailProject, "274438881688"].filter(Boolean))) as string[];
  const api = "https://gsuiteaddons.googleapis.com/v1";
  const call = async (url: string) => {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const text = await r.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 500);
      }
      return { status: r.status, body };
    } catch (e) {
      return { status: 0, error: (e as Error).message };
    }
  };

  const results: Record<string, unknown> = {};
  for (const p of projects) {
    results[`authorization:${p}`] = await call(`${api}/projects/${p}/authorization`);
    const list = await call(`${api}/projects/${p}/deployments`);
    results[`deployments:${p}`] = list;
    // デプロイがあれば install 状態も取得
    const deployments = (list.body as any)?.deployments;
    if (Array.isArray(deployments)) {
      for (const d of deployments.slice(0, 5)) {
        const name = d?.name as string | undefined; // projects/x/deployments/y
        if (name) results[`installStatus:${name}`] = await call(`${api}/${name}/installStatus`);
      }
    }
  }
  out.results = results;

  // 結果をDBにも保存（私が Supabase 経由で読めるように）。
  try {
    await getSupabaseAdmin().from("chat_event_log").insert({
      event_id: crypto.randomUUID(),
      event_type: "admin_diag",
      space_name: null,
      payload: out,
    });
  } catch {
    /* 保存失敗は無視 */
  }

  return NextResponse.json(out);
}
