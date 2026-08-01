import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { isChatConfigured } from "@/lib/chat/client";
import {
  SUBSCRIPTION_EVENT_TYPES,
  createSpaceSubscription,
  renewSubscription,
  updateSubscriptionEventTypes,
} from "@/lib/chat/events-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * P3/P4: Workspace Events 購読の作成/更新（Vercel Cron から起動）。
 * 有効な group スペースごとに、リアクション+メッセージ購読を作成し、
 * 期限が近いものは延長する。購読は期限切れするため定期実行が必須。
 * P3で作成済みの購読（リアクションのみ）は、イベント種別を最新セットへ更新する。
 *
 * 必要な環境変数: CRON_SECRET（認可）, GOOGLE_CHAT_PUBSUB_TOPIC（通知先）,
 *                 GOOGLE_CHAT_SA_CREDENTIALS（アプリ認証）。未設定なら no-op。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const topic = process.env.GOOGLE_CHAT_PUBSUB_TOPIC;
  if (!isChatConfigured() || !topic) {
    return NextResponse.json({ ok: true, skipped: "chat/pubsub not configured" });
  }

  const admin = getSupabaseAdmin();
  const { data: spaces } = await admin
    .from("chat_space_bindings")
    .select("tenant_id, space_name")
    .eq("space_type", "group")
    .eq("is_active", true);

  const soon = Date.now() + 6 * 3600 * 1000; // 6時間以内に切れるものは更新
  let created = 0;
  let renewed = 0;
  let upgraded = 0;
  let failed = 0;

  for (const s of spaces ?? []) {
    const tenantId = s.tenant_id as string;
    const spaceName = s.space_name as string;
    try {
      const { data: sub } = await admin
        .from("chat_subscriptions")
        .select("subscription_name, expire_time, event_types")
        .eq("tenant_id", tenantId)
        .eq("space_name", spaceName)
        .maybeSingle();

      if (sub?.subscription_name) {
        const currentTypes = (sub.event_types ?? []) as string[];
        const missingTypes = SUBSCRIPTION_EVENT_TYPES.some((t) => !currentTypes.includes(t));
        const exp = sub.expire_time ? new Date(sub.expire_time as string).getTime() : 0;
        if (missingTypes) {
          // P3時代の購読（リアクションのみ）→ message.created を含む最新セットへ更新。
          const r = await updateSubscriptionEventTypes(sub.subscription_name as string);
          if (r) {
            await admin
              .from("chat_subscriptions")
              .update({
                event_types: SUBSCRIPTION_EVENT_TYPES,
                expire_time: r.expireTime ?? null,
                state: "active",
                updated_at: new Date().toISOString(),
              })
              .eq("tenant_id", tenantId)
              .eq("space_name", spaceName);
            upgraded += 1;
          }
        } else if (exp < soon) {
          const r = await renewSubscription(sub.subscription_name as string);
          if (r) {
            await admin
              .from("chat_subscriptions")
              .update({ expire_time: r.expireTime ?? null, state: "active", updated_at: new Date().toISOString() })
              .eq("tenant_id", tenantId)
              .eq("space_name", spaceName);
            renewed += 1;
          }
        }
      } else {
        const r = await createSpaceSubscription(spaceName, topic);
        if (r?.name) {
          await admin.from("chat_subscriptions").upsert(
            {
              tenant_id: tenantId,
              space_name: spaceName,
              subscription_name: r.name,
              event_types: SUBSCRIPTION_EVENT_TYPES,
              expire_time: r.expireTime ?? null,
              state: "active",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,space_name" },
          );
          created += 1;
        }
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, created, renewed, upgraded, failed, spaces: (spaces ?? []).length });
}
