"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PROJECT_ROLES } from "@/lib/constants";
import { weekStartOf, addDaysISO, parseHoursInput, todayJST, GENERAL_UNIT } from "@/lib/work-time";
import { decodeFileText, parseDelimited } from "@/lib/lead-import";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normWeek(v: string): string | null {
  return DATE_RE.test(v) ? weekStartOf(v) : null;
}

interface MyUnits {
  talentId: string | null; // 全般稼働の記入先(稼働報告必須のときのみ)
  planByAssignment: Map<string, string>; // assignment_id -> plan_id
  nameMatch: Map<string, string>; // 正規化した案件名/取引先|案件/ラベル -> assignment_id (CSV取込のマッチ用)
}

const normName = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 自分の記入単位(紐づき案件のマスター+全般稼働)をRPCから解決。 */
async function getMyUnits(sb: ReturnType<typeof getSupabaseServer>): Promise<MyUnits | null> {
  const { data, error } = await sb.rpc("my_work_context");
  if (error) return null;
  const d = (data ?? {}) as {
    assignments?: { assignment_id: string; plan_id: string; label: string; opp_name: string; account_name: string }[];
    talent?: { talent_id: string; work_report_required: boolean } | null;
  };
  const planByAssignment = new Map<string, string>();
  const nameMatch = new Map<string, string>();
  for (const a of d.assignments ?? []) {
    planByAssignment.set(a.assignment_id, a.plan_id);
    for (const key of [a.opp_name, `${a.account_name}｜${a.opp_name}`, `${a.account_name}${a.opp_name}`, a.label]) {
      if (key) nameMatch.set(normName(key), a.assignment_id);
    }
  }
  return {
    talentId: d.talent?.work_report_required ? d.talent.talent_id : null,
    planByAssignment,
    nameMatch,
  };
}

/** (unitKey, week) の週状態を取得。unitKey: 'g' or assignment_id */
async function getWeekStates(
  sb: ReturnType<typeof getSupabaseServer>,
  units: MyUnits,
  weekStarts: string[],
): Promise<Map<string, { id: string; status: string }>> {
  const out = new Map<string, { id: string; status: string }>();
  if (weekStarts.length === 0) return out;
  const asgIds = [...units.planByAssignment.keys()];
  const [aR, gR] = await Promise.all([
    asgIds.length
      ? sb.from("work_weeks").select("id, status, assignment_id, week_start").in("assignment_id", asgIds).in("week_start", weekStarts)
      : Promise.resolve({ data: [], error: null }),
    units.talentId
      ? sb.from("work_weeks").select("id, status, assignment_id, week_start").eq("talent_id", units.talentId).is("assignment_id", null).in("week_start", weekStarts)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (aR.error || gR.error) throw new Error("週状態の取得に失敗");
  for (const w of (aR.data ?? []) as { id: string; status: string; assignment_id: string; week_start: string }[]) {
    out.set(`${w.assignment_id}|${w.week_start}`, { id: w.id, status: w.status });
  }
  for (const w of (gR.data ?? []) as { id: string; status: string; week_start: string }[]) {
    out.set(`${GENERAL_UNIT}|${w.week_start}`, { id: w.id, status: w.status });
  }
  return out;
}

const isLocked = (status?: string) => status === "submitted" || status === "approved";

interface EntryRow {
  tenant_id: string;
  plan_id: string | null;
  assignment_id: string | null;
  talent_id: string | null;
  work_date: string;
  week_start: string;
  hours: number;
  task_text: string | null;
  outcome_text: string | null;
  next_action_text: string | null;
  risk_text: string | null;
  memo: string | null;
  created_by: string;
}

function buildRow(
  units: MyUnits,
  unitKey: string,
  tenantId: string,
  userId: string,
  date: string,
  weekStart: string,
  hours: number,
  texts: { task: string | null; outcome: string | null; next: string | null; risk: string | null; memo: string | null },
): EntryRow | null {
  if (unitKey === GENERAL_UNIT) {
    if (!units.talentId) return null;
    return {
      tenant_id: tenantId, plan_id: null, assignment_id: null, talent_id: units.talentId,
      work_date: date, week_start: weekStart, hours,
      task_text: texts.task, outcome_text: texts.outcome, next_action_text: texts.next, risk_text: texts.risk, memo: texts.memo,
      created_by: userId,
    };
  }
  const planId = units.planByAssignment.get(unitKey);
  if (!planId) return null;
  return {
    tenant_id: tenantId, plan_id: planId, assignment_id: unitKey, talent_id: null,
    work_date: date, week_start: weekStart, hours,
    task_text: texts.task, outcome_text: texts.outcome, next_action_text: texts.next, risk_text: texts.risk, memo: texts.memo,
    created_by: userId,
  };
}

/** unit×週の記入行を洗い替え(削除→挿入)。 */
async function rewriteUnitWeek(
  sb: ReturnType<typeof getSupabaseServer>,
  units: MyUnits,
  unitKey: string,
  week: string,
  rows: EntryRow[],
): Promise<boolean> {
  const delQ = sb.from("work_entries").delete().eq("week_start", week);
  const del = unitKey === GENERAL_UNIT
    ? await delQ.eq("talent_id", units.talentId!).is("assignment_id", null)
    : await delQ.eq("assignment_id", unitKey);
  if (del.error) return false;
  if (rows.length) {
    const ins = await sb.from("work_entries").insert(rows);
    if (ins.error) return false;
  }
  return true;
}

/** unit×週の状態行が無ければ下書きとして作成。 */
async function ensureWeekRow(
  sb: ReturnType<typeof getSupabaseServer>,
  units: MyUnits,
  states: Map<string, { id: string; status: string }>,
  unitKey: string,
  week: string,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  if (states.has(`${unitKey}|${week}`)) return true;
  const ins = await sb.from("work_weeks").insert({
    tenant_id: tenantId,
    plan_id: unitKey === GENERAL_UNIT ? null : units.planByAssignment.get(unitKey),
    assignment_id: unitKey === GENERAL_UNIT ? null : unitKey,
    talent_id: unitKey === GENERAL_UNIT ? units.talentId : null,
    week_start: week,
    created_by: userId,
  });
  if (ins.error) return false;
  states.set(`${unitKey}|${week}`, { id: "", status: "draft" });
  return true;
}

/**
 * 週の記入行を保存(全案件+全般稼働をまとめて洗い替え)。
 * 各行の「案件」列(e_unit)で紐づき先を選ぶ。提出済み/承認済みの単位はロック。
 */
export async function saveWorkWeekAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const week = normWeek(String(formData.get("week_start") ?? ""));
  const back = (q: string) => redirect(`/app/work${week ? `?week=${week}&${q}` : `?${q}`}`);
  if (!week) back("error=invalid");

  const sb = getSupabaseServer();
  const units = await getMyUnits(sb);
  if (!units) back("error=load_failed");

  const unitKeys = formData.getAll("e_unit").map(String);
  const dates = formData.getAll("e_date").map(String);
  const hoursArr = formData.getAll("e_hours").map((v) => parseHoursInput(String(v)));
  const tasks = formData.getAll("e_task").map(String);
  const outcomes = formData.getAll("e_outcome").map(String);
  const nexts = formData.getAll("e_next").map(String);
  const risks = formData.getAll("e_risk").map(String);
  const memos = formData.getAll("e_memo").map(String);

  const weekEnd = addDaysISO(week!, 6);
  const t = (s?: string) => (s ?? "").trim() || null;
  const byUnit = new Map<string, EntryRow[]>();
  // 編集可能な全単位を洗い替え対象にする(行が無い単位は全削除の意味)
  const editableUnits = [...units!.planByAssignment.keys(), ...(units!.talentId ? [GENERAL_UNIT] : [])];
  for (const k of editableUnits) byUnit.set(k, []);

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const unitKey = unitKeys[i] ?? "";
    if (!DATE_RE.test(d) || d < week! || d > weekEnd) continue;
    if (!byUnit.has(unitKey)) continue; // 自分の単位以外は無視(RLSでも防止)
    const hours = hoursArr[i] ?? 0;
    const texts = { task: t(tasks[i]), outcome: t(outcomes[i]), next: t(nexts[i]), risk: t(risks[i]), memo: t(memos[i]) };
    if (!hours && !texts.task && !texts.outcome && !texts.next && !texts.risk && !texts.memo) continue; // 空行
    const row = buildRow(units!, unitKey, ctx.tenantId, ctx.userId, d, week!, hours, texts);
    if (row) byUnit.get(unitKey)!.push(row);
  }

  const states = await getWeekStates(sb, units!, [week!]).catch(() => null);
  if (!states) back("error=load_failed");

  for (const [unitKey, rows] of byUnit) {
    const st = states!.get(`${unitKey}|${week!}`)?.status;
    if (isLocked(st)) {
      // ロック中の単位に行を入れようとした場合のみエラー(行が無ければ触らない)
      if (rows.length) back("error=locked");
      continue;
    }
    if (!(await rewriteUnitWeek(sb, units!, unitKey, week!, rows))) back("error=save_failed");
    if (rows.length && !(await ensureWeekRow(sb, units!, states!, unitKey, week!, ctx.tenantId, ctx.userId))) back("error=save_failed");
  }

  revalidatePath("/app/work");
  back("saved=work");
}

/** 週を提出(承認依頼)。記入がある全単位(案件・全般)をまとめて提出する。 */
export async function submitWorkWeekAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const week = normWeek(String(formData.get("week_start") ?? ""));
  const back = (q: string) => redirect(`/app/work${week ? `?week=${week}&${q}` : `?${q}`}`);
  if (!week) back("error=invalid");

  const sb = getSupabaseServer();
  const units = await getMyUnits(sb);
  if (!units) back("error=load_failed");

  const asgIds = [...units!.planByAssignment.keys()];
  const [aCnt, gCnt] = await Promise.all([
    asgIds.length
      ? sb.from("work_entries").select("assignment_id").in("assignment_id", asgIds).eq("week_start", week!)
      : Promise.resolve({ data: [], error: null }),
    units!.talentId
      ? sb.from("work_entries").select("id").eq("talent_id", units!.talentId).is("assignment_id", null).eq("week_start", week!)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (aCnt.error || gCnt.error) back("error=load_failed");
  const unitsWithRows = new Set<string>();
  for (const r of (aCnt.data ?? []) as { assignment_id: string }[]) unitsWithRows.add(r.assignment_id);
  if ((gCnt.data ?? []).length) unitsWithRows.add(GENERAL_UNIT);
  if (unitsWithRows.size === 0) back("error=empty");

  const states = await getWeekStates(sb, units!, [week!]).catch(() => null);
  if (!states) back("error=load_failed");

  const now = new Date().toISOString();
  for (const unitKey of unitsWithRows) {
    const st = states!.get(`${unitKey}|${week!}`);
    if (st && isLocked(st.status)) continue; // 提出済み/承認済みはそのまま
    if (st?.id) {
      const up = await sb.from("work_weeks").update({ status: "submitted", submitted_at: now, reviewed_at: null, reviewed_by: null }).eq("id", st.id);
      if (up.error) back("error=save_failed");
    } else {
      const ins = await sb.from("work_weeks").insert({
        tenant_id: ctx.tenantId,
        plan_id: unitKey === GENERAL_UNIT ? null : units!.planByAssignment.get(unitKey),
        assignment_id: unitKey === GENERAL_UNIT ? null : unitKey,
        talent_id: unitKey === GENERAL_UNIT ? units!.talentId : null,
        week_start: week!,
        status: "submitted",
        submitted_at: now,
        created_by: ctx.userId,
      });
      if (ins.error) back("error=save_failed");
    }
  }
  revalidatePath("/app/work");
  revalidatePath("/app/projects/approvals");
  back("saved=submit");
}

// ---- CSV取込(スプレッドシート運用の継続用) ----

/** 日付の正規化: 2026/6/8, 2026-06-08, 6/8(年なし→今年) など。不正は null。 */
function normDate(v: string): string | null {
  const s = v.trim().normalize("NFKC").replace(/[年月]/g, "/").replace(/日/g, "");
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})$/);
  if (m) {
    const y = Number(todayJST().slice(0, 4));
    const [mo, d] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/**
 * 稼働報告CSV/TSVの取込。スプレッドシートの列(日付/稼働時間/案件名/タスク/成果/
 * Next Action/リスク・懸念/メモ)をヘッダー名で自動マッピングし、日付から週を判定して追記する。
 * - 案件名は自分の紐づき案件(担当者マスター)に自動マッチ。不明な案件名・空欄は全般稼働へ
 * - 提出済み/承認済みの週はスキップ(取込後に画面で確認→提出する運用)
 */
export async function importWorkCsvAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const back = (q: string) => redirect(`/app/work?${q}`);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back("error=no_file");
  if ((file as File).size > 2 * 1024 * 1024) back("error=too_large");

  const sb = getSupabaseServer();
  const units = await getMyUnits(sb);
  if (!units) back("error=load_failed");
  if (units!.planByAssignment.size === 0 && !units!.talentId) back("error=no_target");

  const text = decodeFileText(await (file as File).arrayBuffer());
  const delim = (text.split("\n", 1)[0] ?? "").includes("\t") ? "\t" : ",";
  const grid = parseDelimited(text, delim).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) back("error=format");

  // ヘッダー行を先頭20行から探す(タイトル行等のゴミを許容)
  const findCol = (hs: string[], re: RegExp) => hs.findIndex((h) => re.test(h.trim()));
  let headerIdx = -1;
  let cols = { date: -1, hours: -1, opp: -1, task: -1, outcome: -1, next: -1, risk: -1, memo: -1 };
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const hs = grid[i].map((h) => h.normalize("NFKC"));
    const date = findCol(hs, /日付|date/i);
    const hours = findCol(hs, /稼働時間|時間|hours/i);
    if (date >= 0 && hours >= 0) {
      headerIdx = i;
      cols = {
        date,
        hours,
        opp: findCol(hs, /案件|プロジェクト/),
        task: findCol(hs, /タスク|作業/),
        outcome: findCol(hs, /成果/),
        next: findCol(hs, /next|ネクスト/i),
        risk: findCol(hs, /リスク|懸念/),
        memo: findCol(hs, /メモ|備考/),
      };
      break;
    }
  }
  if (headerIdx < 0) back("error=format");

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const t = (s: string) => s.trim() || null;
  const byUnitWeek = new Map<string, EntryRow[]>();
  let unmatched = 0;
  let invalid = 0;
  for (const r of grid.slice(headerIdx + 1)) {
    const rawDate = cell(r, cols.date);
    const hours = parseHoursInput(cell(r, cols.hours));
    const texts = {
      task: t(cell(r, cols.task)),
      outcome: t(cell(r, cols.outcome)),
      next: t(cell(r, cols.next)),
      risk: t(cell(r, cols.risk)),
      memo: t(cell(r, cols.memo)),
    };
    if (!rawDate && !hours && !texts.task && !texts.outcome) continue; // 空行・集計行
    const date = normDate(rawDate);
    if (!date || (!hours && !texts.task && !texts.outcome)) { invalid++; continue; }

    // 案件名→自分の紐づき案件へマッチ。空欄/不一致は全般稼働(名前は保全)
    const oppName = cell(r, cols.opp);
    let unitKey: string | null = null;
    if (oppName && units!.nameMatch.has(normName(oppName))) {
      unitKey = units!.nameMatch.get(normName(oppName))!;
    } else if (units!.talentId) {
      unitKey = GENERAL_UNIT;
      if (oppName) { unmatched++; texts.task = `【${oppName}】${texts.task ?? ""}`.trim() || null; }
    } else if (units!.planByAssignment.size === 1 && !oppName) {
      unitKey = [...units!.planByAssignment.keys()][0]; // 案件列なし&単一アサインなら自明
    } else { unmatched++; continue; }

    const week = weekStartOf(date);
    const row = buildRow(units!, unitKey, ctx.tenantId, ctx.userId, date, week, hours, texts);
    if (!row) { invalid++; continue; }
    const k = `${unitKey}|${week}`;
    (byUnitWeek.get(k) ?? byUnitWeek.set(k, []).get(k)!).push(row);
  }
  if (byUnitWeek.size === 0) back(`error=no_rows`);

  const weekStarts = [...new Set([...byUnitWeek.keys()].map((k) => k.split("|")[1]))];
  const states = await getWeekStates(sb, units!, weekStarts).catch(() => null);
  if (!states) back("error=load_failed");

  let imported = 0;
  let lockedSkipped = 0;
  const sortedKeys = [...byUnitWeek.keys()].sort((a, b) => a.split("|")[1].localeCompare(b.split("|")[1]));
  for (const k of sortedKeys) {
    const [unitKey, week] = k.split("|");
    const rows = byUnitWeek.get(k)!;
    if (isLocked(states!.get(k)?.status)) { lockedSkipped += rows.length; continue; }
    const ins = await sb.from("work_entries").insert(rows); // 追記(既存行は消さない)
    if (ins.error) back("error=save_failed");
    imported += rows.length;
    if (!(await ensureWeekRow(sb, units!, states!, unitKey, week, ctx.tenantId, ctx.userId))) back("error=save_failed");
  }

  const firstWeek = sortedKeys.length ? sortedKeys[0].split("|")[1] : weekStartOf(todayJST());
  revalidatePath("/app/work");
  back(`week=${firstWeek}&saved=import&n=${imported}&lk=${lockedSkipped}&um=${unmatched}&iv=${invalid}`);
}

// ---- 承認(管理職) ----

/** 週を承認(管理職)。承認済み実績が原価管理・月次請求の元データになる。 */
export async function approveWorkWeekAction(formData: FormData): Promise<void> {
  await reviewWorkWeek(formData, "approved", "saved=approve");
}

/** 週を差戻し(管理職)。記入者は修正して再提出できる。 */
export async function returnWorkWeekAction(formData: FormData): Promise<void> {
  await reviewWorkWeek(formData, "returned", "saved=return");
}

async function reviewWorkWeek(formData: FormData, status: "approved" | "returned", savedQ: string): Promise<void> {
  const ctx = await requireCtx();
  const id = String(formData.get("week_id") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const back = (q: string) => redirect(`/app/projects/approvals${month ? `?month=${month}&${q}` : `?${q}`}`);
  if (!PROJECT_ROLES.includes(ctx.role)) back("error=forbidden");
  if (!id) back("error=invalid");

  const sb = getSupabaseServer();
  const note = String(formData.get("review_note") ?? "").trim() || null;
  const up = await sb.from("work_weeks").update({
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: ctx.userId,
    review_note: note,
  }).eq("id", id).eq("status", "submitted").select("id");
  if (up.error) back("error=save_failed");
  if (!up.data?.length) back("error=not_pending");

  revalidatePath("/app/projects/approvals");
  revalidatePath("/app/projects");
  revalidatePath("/app/work");
  back(savedQ);
}

/**
 * 稼働報告メンバーを案件原価に紐づける(=タレントをアサインとして追加)。
 * 単価は台帳の時給を初期値に(時給単価)。詳細調整は原価管理の案件詳細で。
 */
export async function assignTalentToPlanAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const month = String(formData.get("month") ?? "").trim();
  const back = (q: string) => redirect(`/app/projects/approvals${month ? `?month=${month}&${q}` : `?${q}`}`);
  if (!PROJECT_ROLES.includes(ctx.role)) back("error=forbidden");
  const talentId = String(formData.get("talent_id") ?? "").trim();
  const planId = String(formData.get("link_plan_id") ?? "").trim();
  if (!talentId || !planId) back("error=invalid");

  const sb = getSupabaseServer();
  const [talR, dupR] = await Promise.all([
    sb.from("talents").select("id, name, employment_type, hourly_rate, role_text").eq("id", talentId).maybeSingle(),
    sb.from("project_assignments").select("id").eq("plan_id", planId).eq("talent_id", talentId).eq("status", "active").limit(1),
  ]);
  if (talR.error || !talR.data) back("error=load_failed");
  if (dupR.error) back("error=load_failed");
  if (dupR.data?.length) back("error=already_linked");
  const t = talR.data as { id: string; name: string; employment_type: string; hourly_rate: number | null; role_text: string | null };

  const ins = await sb.from("project_assignments").insert({
    tenant_id: ctx.tenantId,
    plan_id: planId,
    kind: t.employment_type === "employee" ? "internal" : "external",
    talent_id: t.id,
    label: t.name,
    role: t.role_text,
    cost_rate: Number(t.hourly_rate) || 0,
    rate_unit: "hourly",
    effort_unit: "hours",
    status: "active",
  });
  if (ins.error) back("error=save_failed");

  revalidatePath("/app/projects/approvals");
  revalidatePath("/app/projects");
  revalidatePath("/app/work");
  back("saved=link");
}

/** 案件紐づけを解除(アサインをremovedに)。過去の実績・原価は保持される。 */
export async function unlinkTalentAssignmentAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  const month = String(formData.get("month") ?? "").trim();
  const back = (q: string) => redirect(`/app/projects/approvals${month ? `?month=${month}&${q}` : `?${q}`}`);
  if (!PROJECT_ROLES.includes(ctx.role)) back("error=forbidden");
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) back("error=invalid");

  const sb = getSupabaseServer();
  const up = await sb.from("project_assignments").update({ status: "removed" }).eq("id", assignmentId);
  if (up.error) back("error=save_failed");

  revalidatePath("/app/projects/approvals");
  revalidatePath("/app/projects");
  revalidatePath("/app/work");
  back("saved=unlink");
}
