import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { secureCompare } from "@/lib/secure-compare";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getChatCredentials, getChatAccessToken } from "@/lib/chat/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GSA_API = "https://gsuiteaddons.googleapis.com/v1";

/**
 * 【一時診断/修復】Google Workspace アドオンのデプロイ状態照会・作成・インストール。
 * P2の対話イベントが1件も届かない原因（デプロイ不在）を解消するための一時ツール。
 * 認可: 固定トークン（?token=）または CRON_SECRET。原因解消後にエンドポイントごと除去する。
 *
 * 使い方:
 *   /api/chat/admin-diag?token=..                      → 一覧(既定)
 *   /api/chat/admin-diag?token=..&action=discovery     → APIスキーマ取得
 *   /api/chat/admin-diag?token=..&action=raw&method=GET&path=/projects/catorce-chat/deployments
 *   /api/chat/admin-diag?token=..&action=raw&method=POST&path=/projects/catorce-chat/deployments?deploymentId=x&body=<base64 json>
 */
export async function GET(req: Request) {
  const DIAG_TOKEN = "c64a03d0bc7a70cc5ea57694b5babc8a33528dec15883077";
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  const authed =
    secureCompare(queryToken, DIAG_TOKEN) ||
    (!!secret &&
      (secureCompare(req.headers.get("authorization"), `Bearer ${secret}`) ||
        secureCompare(queryToken, secret)));
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const creds = getChatCredentials();
  const emailProject =
    creds?.client_email?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? null;
  const token = await getChatAccessToken("https://www.googleapis.com/auth/cloud-platform");
  if (!token) return NextResponse.json({ error: "no cloud-platform token", emailProject });

  const doFetch = async (method: string, fullUrl: string, body?: unknown) => {
    try {
      const r = await fetch(fullUrl, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text.slice(0, 1000);
      }
      return { status: r.status, body: parsed };
    } catch (e) {
      return { status: 0, error: (e as Error).message };
    }
  };

  const action = url.searchParams.get("action") ?? "list";
  const out: Record<string, unknown> = { emailProject, action };

  if (action === "discovery") {
    const r = await doFetch("GET", `https://gsuiteaddons.googleapis.com/$discovery/rest?version=v1`);
    const schemas = (r.body as any)?.schemas ?? {};
    const pick: Record<string, unknown> = {};
    for (const k of Object.keys(schemas)) {
      if (/deploy|chat|addon|manifest|authoriz/i.test(k)) pick[k] = schemas[k];
    }
    out.status = r.status;
    out.schemaKeys = Object.keys(schemas);
    out.schemas = pick;
  } else if (action === "raw") {
    const method = (url.searchParams.get("method") ?? "GET").toUpperCase();
    const path = url.searchParams.get("path") ?? "";
    const b64 = url.searchParams.get("body");
    let body: unknown = undefined;
    if (b64) {
      try {
        body = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      } catch (e) {
        return NextResponse.json({ error: `bad body b64: ${(e as Error).message}` });
      }
    }
    out.result = await doFetch(method, `${GSA_API}${path}`, body);
  } else {
    const projects = Array.from(new Set([emailProject, "274438881688"].filter(Boolean))) as string[];
    const results: Record<string, unknown> = {};
    for (const p of projects) {
      results[`authorization:${p}`] = await doFetch("GET", `${GSA_API}/projects/${p}/authorization`);
      results[`deployments:${p}`] = await doFetch("GET", `${GSA_API}/projects/${p}/deployments`);
    }
    out.results = results;
  }

  try {
    await getSupabaseAdmin()
      .from("chat_event_log")
      .insert({ event_id: crypto.randomUUID(), event_type: "admin_diag", space_name: null, payload: out });
  } catch {
    /* 無視 */
  }
  return NextResponse.json(out);
}
