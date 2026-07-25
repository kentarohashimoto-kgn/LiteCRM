"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { fetchCalendarFeed, validateFeedUrl } from "@/lib/calendar-feed";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Googleカレンダー非公開URL(iCal)の登録・解除・接続テスト。
 * URLは本人の資格情報なので暗号化して保存し、RLSでも本人しか読めない。
 */

export interface FeedStatus {
  connected: boolean;
  /** 表示用にマスクしたURL(末尾の秘密鍵は伏せる) */
  masked: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastEventCount: number | null;
}

/** URLの秘密部分を伏せて表示用にする。 */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return `${u.origin}/${parts.slice(1, 3).join("/")}/…/basic.ics`;
  } catch {
    return "登録済み";
  }
}

/** 現在の連携状態を取得。 */
export async function getCalendarFeedStatus(): Promise<FeedStatus> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("user_calendar_feeds")
    .select("ics_url_enc,last_synced_at,last_error,last_event_count,status")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!data || (data as any).status !== "active") {
    return { connected: false, masked: null, lastSyncedAt: null, lastError: null, lastEventCount: null };
  }
  let masked: string | null = "登録済み";
  try {
    masked = maskUrl(decryptSecret((data as any).ics_url_enc));
  } catch {
    /* 復号できない場合はマスク表示のみ */
  }
  return {
    connected: true,
    masked,
    lastSyncedAt: (data as any).last_synced_at ?? null,
    lastError: (data as any).last_error ?? null,
    lastEventCount: (data as any).last_event_count ?? null,
  };
}

/**
 * 非公開URLを保存する。保存前に必ず実際に取得してみて、
 * 動くURLだけを登録する(貼り間違いをその場で気づけるように)。
 */
export async function saveCalendarFeedAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const url = String(formData.get("ics_url") ?? "").trim();

  const fail = (msg: string) => redirectSettings(msg, false);

  const secretMissing = !mailCredSecretConfigured()
    ? "暗号化キー MAIL_CRED_SECRET が未設定です。Vercel → Settings → Environment Variables に " +
      "MAIL_CRED_SECRET（openssl rand -base64 48 などで作った長いランダム文字列）を追加し、再デプロイしてください。"
    : null;

  // 問題は一度にまとめて返す(片方を直したらもう片方で弾かれる、を避ける)
  const checked = validateFeedUrl(url);
  if (!checked.ok) return fail([checked.error, secretMissing].filter(Boolean).join(" / "));
  if (secretMissing) return fail(secretMissing);

  // 接続テスト: 今日から2週間ぶんを実際に取得
  const now = new Date();
  const to = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  const res = await fetchCalendarFeed(checked.url, now, to);
  if (!res.ok) return fail(res.error);

  const sb = getSupabaseServer();
  const { error } = await sb.from("user_calendar_feeds").upsert(
    {
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      ics_url_enc: encryptSecret(checked.url),
      status: "active",
      last_synced_at: new Date().toISOString(),
      last_error: null,
      last_event_count: res.events.length,
    },
    { onConflict: "user_id" },
  );
  if (error) return fail(`保存に失敗しました: ${error.message}`);

  revalidatePath("/app/settings");
  revalidatePath("/app/mindmaps");
  redirectSettings(`カレンダーを連携しました（今後2週間で${res.events.length}件の予定を確認）`, true);
}

/** 連携を解除する。 */
export async function disconnectCalendarFeedAction(): Promise<void> {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  await sb.from("user_calendar_feeds").delete().eq("user_id", ctx.userId);
  revalidatePath("/app/settings");
  revalidatePath("/app/mindmaps");
  redirectSettings("カレンダー連携を解除しました", true);
}

function redirectSettings(message: string, ok: boolean): never {
  redirect(`/app/settings?calendar=${ok ? "ok" : "ng"}&msg=${encodeURIComponent(message)}`);
}

/**
 * 週次マインドマップ生成で使う: 本人のフィードから予定を取得。
 * 未登録なら null(呼び出し側でCRMのみの生成にフォールバック)。
 */
export async function loadFeedEventsForUser(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ events: import("@/lib/ics").IcsEvent[] } | { error: string } | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("user_calendar_feeds")
    .select("ics_url_enc,status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || (data as any).status !== "active") return null;

  let url: string;
  try {
    url = decryptSecret((data as any).ics_url_enc);
  } catch {
    return { error: "カレンダーURLを復号できませんでした（MAIL_CRED_SECRET を確認してください）" };
  }

  const res = await fetchCalendarFeed(url, from, to);
  if (!res.ok) {
    await sb
      .from("user_calendar_feeds")
      .update({ last_error: res.error.slice(0, 300), last_synced_at: new Date().toISOString() })
      .eq("user_id", userId);
    return { error: res.error };
  }
  await sb
    .from("user_calendar_feeds")
    .update({ last_error: null, last_synced_at: new Date().toISOString(), last_event_count: res.events.length })
    .eq("user_id", userId);
  return { events: res.events };
}
