import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/secure-compare";
import { decryptSecret, mailCredSecretConfigured } from "@/lib/crypto-mail";
import { deliverTrackedEmail } from "@/lib/mail-deliver";
import { renderEmailTemplate } from "@/lib/email";
import { addDays, jstToday, evalStop, type SequenceStep, type StopOn } from "@/lib/sequences";

export const dynamic = "force-dynamic";

/**
 * WO-21 メールシーケンス送信(F-101b・日次)。
 * 期日到来の active な投入(enrollment)について、案件状態で自動停止判定→当日ステップを
 * 投入者本人のSMTPアカウント経由で送信(WO-22の共通コア)。開封/クリックも計測される。
 * 認可: Bearer CRON_SECRET。停止: batch_job_settings(job_kind='email_sequences')。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET未設定" }, { status: 503 });
  if (!checkBearer(req, secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!mailCredSecretConfigured()) return NextResponse.json({ ok: false, error: "MAIL_CRED_SECRET未設定" }, { status: 503 });

  const admin = getSupabaseAdmin();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const today = jstToday(Date.now());
  const startedAt = new Date().toISOString();

  const { data: jobRows } = await admin.from("batch_job_settings").select("tenant_id, enabled").eq("job_kind", "email_sequences");
  const enabledTenants = new Set((jobRows ?? []).filter((j) => j.enabled).map((j) => j.tenant_id as string));
  if (enabledTenants.size === 0) return NextResponse.json({ ok: true, skipped: "job disabled", sent: 0 });

  // 期日到来の active enrollment
  const { data: enrolls } = await admin
    .from("sequence_enrollments")
    .select("id, tenant_id, sequence_id, contact_id, account_id, opportunity_id, to_addr, current_step, enrolled_by")
    .eq("status", "active")
    .lte("next_due_date", today)
    .limit(500);
  const due = (enrolls ?? []).filter((e) => enabledTenants.has(e.tenant_id as string));
  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0, note: "対象なし" });

  // 参照データをまとめて取得
  const seqIds = [...new Set(due.map((e) => e.sequence_id as string))];
  const oppIds = [...new Set(due.map((e) => e.opportunity_id).filter(Boolean) as string[])];
  const accIds = [...new Set(due.map((e) => e.account_id).filter(Boolean) as string[])];
  const contactIds = [...new Set(due.map((e) => e.contact_id).filter(Boolean) as string[])];
  const userIds = [...new Set(due.map((e) => e.enrolled_by as string))];

  const [seqR, oppR, accR, contactR, profR, mailR] = await Promise.all([
    admin.from("email_sequences").select("id, steps, stop_on, status").in("id", seqIds),
    oppIds.length ? admin.from("opportunities").select("id, yomi, name").in("id", oppIds) : Promise.resolve({ data: [] as never[] }),
    accIds.length ? admin.from("accounts").select("id, name").in("id", accIds) : Promise.resolve({ data: [] as never[] }),
    contactIds.length ? admin.from("contacts").select("id, name").in("id", contactIds) : Promise.resolve({ data: [] as never[] }),
    admin.from("profiles").select("id, display_name, email").in("id", userIds),
    admin.from("user_mail_accounts").select("user_id, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, from_email, from_name, bcc_self, status").in("user_id", userIds),
  ]);

  const seqMap = new Map((seqR.data ?? []).map((s) => [s.id as string, s]));
  const oppMap = new Map((oppR.data ?? []).map((o) => [o.id as string, o]));
  const accMap = new Map((accR.data ?? []).map((a) => [a.id as string, a.name as string]));
  const contactMap = new Map((contactR.data ?? []).map((c) => [c.id as string, c.name as string]));
  const profMap = new Map((profR.data ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || ""]));
  const mailMap = new Map((mailR.data ?? []).map((m) => [m.user_id as string, m]));

  // テンプレ取得(全ステップ分)
  const tplIds = new Set<string>();
  for (const s of seqR.data ?? []) for (const st of (s.steps as SequenceStep[]) ?? []) tplIds.add(st.template_id);
  const tplR = tplIds.size ? await admin.from("email_templates").select("id, subject_tmpl, body_tmpl").in("id", [...tplIds]) : { data: [] as never[] };
  const tplMap = new Map((tplR.data ?? []).map((t) => [t.id as string, t]));

  let sent = 0, stopped = 0, completed = 0, skipped = 0, failed = 0;

  for (const e of due) {
    const seq = seqMap.get(e.sequence_id as string);
    if (!seq || seq.status !== "active") { skipped++; continue; }
    const steps = (seq.steps as SequenceStep[]) ?? [];
    const stepIdx = e.current_step as number;

    // 自動停止判定(案件のヨミ)
    const opp = e.opportunity_id ? oppMap.get(e.opportunity_id as string) : null;
    const stopReason = evalStop(seq.stop_on as StopOn, (opp?.yomi as string) ?? null);
    if (stopReason) {
      await admin.from("sequence_enrollments").update({ status: "stopped", stopped_reason: stopReason }).eq("id", e.id);
      stopped++;
      continue;
    }

    const step = steps[stepIdx];
    if (!step) {
      await admin.from("sequence_enrollments").update({ status: "completed" }).eq("id", e.id);
      completed++;
      continue;
    }

    // 冪等性: このenrollment×stepの送信済みがあれば再送しない(スケジュールだけ進める)
    const { data: existing } = await admin
      .from("email_messages")
      .select("id")
      .eq("sequence_enrollment_id", e.id)
      .eq("sequence_step", stepIdx)
      .in("status", ["sent", "queued"])
      .limit(1);
    const alreadySent = !!existing?.length;

    if (!alreadySent) {
      const acc = mailMap.get(e.enrolled_by as string);
      if (!acc || acc.status !== "active") { skipped++; continue; } // 未接続は今回スキップ(次回リトライ)
      const tpl = tplMap.get(step.template_id);
      if (!tpl) {
        await admin.from("sequence_enrollments").update({ status: "stopped", stopped_reason: "テンプレート欠落" }).eq("id", e.id);
        stopped++;
        continue;
      }

      const vars = {
        contact: e.contact_id ? contactMap.get(e.contact_id as string) ?? null : null,
        company: e.account_id ? accMap.get(e.account_id as string) ?? null : null,
        opportunity: (opp?.name as string) ?? null,
        sender: profMap.get(e.enrolled_by as string) ?? "",
      };
      let password = "";
      try { password = decryptSecret(acc.smtp_password_enc as string); }
      catch { skipped++; continue; }

      const res = await deliverTrackedEmail(admin, {
        tenantId: e.tenant_id as string,
        loggedBy: e.enrolled_by as string,
        account: {
          host: acc.smtp_host as string, port: acc.smtp_port as number, secure: acc.smtp_secure as boolean,
          username: acc.smtp_username as string, password,
          fromEmail: acc.from_email as string, fromName: acc.from_name as string | null,
        },
        bccSelf: acc.bcc_self as boolean,
        to: e.to_addr as string,
        subject: renderEmailTemplate((tpl.subject_tmpl as string) ?? "", vars),
        body: renderEmailTemplate((tpl.body_tmpl as string) ?? "", vars),
        contactId: e.contact_id as string | null,
        accountId: e.account_id as string | null,
        opportunityId: e.opportunity_id as string | null,
        templateId: step.template_id,
        sequenceEnrollmentId: e.id as string,
        sequenceStep: stepIdx,
        createActivity: true,
        baseUrl,
      });
      if (!res.ok) {
        // 送信失敗は停止(無限リトライを避ける・UIで原因を確認)
        await admin.from("sequence_enrollments").update({ status: "stopped", stopped_reason: `送信失敗: ${res.error.slice(0, 120)}` }).eq("id", e.id);
        failed++;
        continue;
      }
      sent++;
    }

    // スケジュールを次ステップへ
    const nextIdx = stepIdx + 1;
    if (nextIdx < steps.length) {
      await admin.from("sequence_enrollments").update({
        current_step: nextIdx,
        next_due_date: addDays(today, Math.max(0, steps[nextIdx].wait_days | 0)),
        last_sent_at: new Date().toISOString(),
      }).eq("id", e.id);
    } else {
      await admin.from("sequence_enrollments").update({
        current_step: nextIdx, status: "completed", last_sent_at: new Date().toISOString(),
      }).eq("id", e.id);
      completed++;
    }
  }

  // 運用ログ
  try {
    const repTenant = due[0]?.tenant_id as string | undefined;
    if (repTenant) {
      await admin.from("batch_runs").insert({
        tenant_id: repTenant, job_kind: "email_sequences", run_date: today,
        started_at: startedAt, ended_at: new Date().toISOString(),
        status: failed ? "partial" : "success",
        targets_total: due.length, items_generated: sent, items_failed: failed,
        detail: { sent, stopped, completed, skipped, failed },
      });
    }
  } catch { /* ログ失敗は無視 */ }

  return NextResponse.json({ ok: true, targets: due.length, sent, stopped, completed, skipped, failed });
}
