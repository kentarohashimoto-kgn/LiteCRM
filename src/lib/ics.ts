/**
 * iCalendar(ICS)のパースと繰り返し予定の展開。
 *
 * Googleカレンダーの「非公開URL(iCal形式)」を取り込むために使う。
 * OAuth(Google Cloud Consoleでの同意画面設定)が要らないため、URLを貼るだけで連携できる。
 *
 * 外部ライブラリ非依存・純関数。タイムゾーンは IANA 名を Intl で解決するので、
 * TZID=Asia/Tokyo 以外(海外の予定)や夏時間も正しく扱える。
 * 実カレンダーでは50件中18件が繰り返し予定だったため、RRULE展開は必須。
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  /** 開始/終了(UTCのISO文字列)。終日予定は startAt=null。 */
  startAt: string | null;
  endAt: string | null;
  /** JSTの YYYY-MM-DD(日別グルーピングのキー) */
  date: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
}

/* ------------------------------------------------------------------ */
/* 行の展開・プロパティ解析                                            */
/* ------------------------------------------------------------------ */

/** RFC5545 の折り返し(次行が空白で始まる)を戻す。 */
export function unfoldLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** 「DTSTART;TZID=Asia/Tokyo:20260727T090000」を分解する。 */
export function parseProp(line: string): IcsProp | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments = head.split(";");
  const name = segments[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** 引用符の外側にある最初の区切り位置。 */
function indexOfUnquoted(s: string, ch: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inQuote = !inQuote;
    else if (s[i] === ch && !inQuote) return i;
  }
  return -1;
}

/** TEXT値のエスケープを戻す。 */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/* ------------------------------------------------------------------ */
/* 日時                                                                */
/* ------------------------------------------------------------------ */

/** 指定インスタントにおけるタイムゾーンのオフセット(ms)。 */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** タイムゾーン付きのローカル日時をUTCの実時刻に変換(夏時間も考慮)。 */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = naive;
  // オフセットは時刻自身に依存するため2回で収束させる
  for (let i = 0; i < 2; i++) ts = naive - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface IcsDateValue {
  date: Date;
  allDay: boolean;
}

/**
 * DTSTART/DTEND/EXDATE の値を解釈する。
 *  - 20260727T090000Z    → UTC
 *  - 20260727T090000     → TZID(なければ既定TZ)のローカル時刻
 *  - 20260727            → 終日
 */
export function parseIcsDate(value: string, params: Record<string, string>, defaultTz: string): IcsDateValue | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    // 終日予定は「その日」を表す。JST基準で日付が変わらないよう正午UTCに置く。
    return { date: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0)), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const nums = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)] as const;
  if (z) {
    return { date: new Date(Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5])), allDay: false };
  }
  const tzid = params.TZID && isValidTz(params.TZID) ? params.TZID : defaultTz;
  return { date: zonedTimeToUtc(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5], tzid), allDay: false };
}

/** JST の YYYY-MM-DD。 */
function jstDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

/* ------------------------------------------------------------------ */
/* RRULE 展開                                                          */
/* ------------------------------------------------------------------ */

export interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: Date | null;
  /** BYDAY。MONTHLY では "2TU"(第2火曜)のような序数つきもある。 */
  byDay: string[];
  byMonthDay: number[];
}

const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRRule(value: string, defaultTz: string): RRule | null {
  const parts: Record<string, string> = {};
  for (const seg of value.split(";")) {
    const eq = seg.indexOf("=");
    if (eq > 0) parts[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  const freq = (parts.FREQ ?? "").toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;

  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL, {}, defaultTz)?.date ?? null : null;
  return {
    freq: freq as RRule["freq"],
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until,
    byDay: parts.BYDAY ? parts.BYDAY.split(",").map((d) => d.trim().toUpperCase()) : [],
    byMonthDay: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(",").map((n) => Number(n)) : [],
  };
}

/** 展開の暴走を防ぐ上限(1件の繰り返し予定あたり)。 */
const MAX_OCCURRENCES = 10000;

/**
 * DTSTART と RRULE から、[from, to) に入る発生日時を列挙する。
 * 週次マップは7日ぶんしか要らないので、窓を超えたら打ち切る。
 */
export function expandRRule(dtStart: Date, rule: RRule, from: Date, to: Date, tz: string): Date[] {
  const out: Date[] = [];
  const startMs = dtStart.getTime();

  // 開始時刻(TZ内のローカル時分秒)を保つため、TZ内での各フィールドを取り出す
  const local = tzParts(dtStart, tz);
  let emitted = 0;

  if (rule.freq === "DAILY") {
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const d = zonedTimeToUtc(local.y, local.mo, local.d + i * rule.interval, local.h, local.mi, local.s, tz);
      if (d.getTime() >= to.getTime()) break;
      if (rule.until && d.getTime() > rule.until.getTime()) break;
      if (d.getTime() >= from.getTime()) out.push(d);
      if (rule.count && ++emitted >= rule.count) break;
    }
    return out;
  }

  if (rule.freq === "WEEKLY") {
    const days = rule.byDay.length > 0 ? rule.byDay.map((d) => DAY_INDEX[d.slice(-2)]).filter((n) => n != null) : [dowInTz(dtStart, tz)];
    // DTSTART の週頭(日曜)を基準に、interval 週ごとに BYDAY を出す
    const startDow = dowInTz(dtStart, tz);
    for (let w = 0; w < MAX_OCCURRENCES; w++) {
      let past = true;
      for (const dow of days) {
        const offset = w * 7 * rule.interval + (dow - startDow);
        if (offset < 0) continue;
        const d = zonedTimeToUtc(local.y, local.mo, local.d + offset, local.h, local.mi, local.s, tz);
        if (rule.until && d.getTime() > rule.until.getTime()) return out;
        if (d.getTime() < to.getTime()) past = false;
        if (d.getTime() >= from.getTime() && d.getTime() < to.getTime()) out.push(d);
        if (rule.count && ++emitted >= rule.count) return out;
      }
      if (past && w > 0) break;
    }
    return out;
  }

  if (rule.freq === "MONTHLY") {
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const monthIndex = local.mo - 1 + i * rule.interval;
      const y = local.y + Math.floor(monthIndex / 12);
      const mo = (monthIndex % 12) + 1;
      const candidates: number[] = [];
      if (rule.byDay.length > 0) {
        for (const spec of rule.byDay) {
          const nth = Number(spec.slice(0, -2)) || 1;
          const dow = DAY_INDEX[spec.slice(-2)];
          if (dow == null) continue;
          const day = nthWeekdayOfMonth(y, mo, dow, nth);
          if (day) candidates.push(day);
        }
      } else if (rule.byMonthDay.length > 0) {
        candidates.push(...rule.byMonthDay.filter((n) => n > 0));
      } else {
        candidates.push(local.d);
      }
      let anyBefore = false;
      for (const day of candidates.sort((a, b) => a - b)) {
        const d = zonedTimeToUtc(y, mo, day, local.h, local.mi, local.s, tz);
        if (rule.until && d.getTime() > rule.until.getTime()) return out;
        if (d.getTime() < to.getTime()) anyBefore = true;
        if (d.getTime() >= from.getTime() && d.getTime() < to.getTime() && d.getTime() >= startMs) out.push(d);
        if (rule.count && ++emitted >= rule.count) return out;
      }
      if (!anyBefore && i > 0) break;
    }
    return out;
  }

  // YEARLY
  for (let i = 0; i < 200; i++) {
    const d = zonedTimeToUtc(local.y + i * rule.interval, local.mo, local.d, local.h, local.mi, local.s, tz);
    if (d.getTime() >= to.getTime()) break;
    if (rule.until && d.getTime() > rule.until.getTime()) break;
    if (d.getTime() >= from.getTime() && d.getTime() >= startMs) out.push(d);
    if (rule.count && ++emitted >= rule.count) break;
  }
  return out;
}

function tzParts(d: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) if (part.type !== "literal") p[part.type] = part.value;
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

function dowInTz(d: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? 0;
}

/** その月の第n(dow)曜日の日付。n<0 は月末から。該当なしは null。 */
function nthWeekdayOfMonth(y: number, mo: number, dow: number, nth: number): number | null {
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const days: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === dow) days.push(d);
  }
  if (days.length === 0) return null;
  return nth > 0 ? days[nth - 1] ?? null : days[days.length + nth] ?? null;
}

/* ------------------------------------------------------------------ */
/* 巨大カレンダー対策(ストリーム絞り込み)                              */
/* ------------------------------------------------------------------ */

/**
 * 文字列チャンクの列を行に分割する(ストリーム処理用)。
 * 実カレンダーの basic.ics は過去数年ぶんを含み数十MBになるため、
 * 全文をメモリに載せずに扱えるようにする。
 */
export async function* toLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let carry = "";
  for await (const chunk of chunks) {
    carry += chunk;
    let nl: number;
    while ((nl = carry.indexOf("\n")) >= 0) {
      yield carry.slice(0, nl).replace(/\r$/, "");
      carry = carry.slice(nl + 1);
    }
  }
  if (carry) yield carry.replace(/\r$/, "");
}

/** ブロック内だけで折り返しを戻す(関連判定にDTSTARTが要るため)。 */
function unfoldBlock(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/**
 * 期間に関係しうる VEVENT だけを残した ICS を組み立てて返す。
 *
 * 残す条件:
 *   - RRULE を持つ(何年も前に始まった繰り返しが今週に来ることがある)
 *   - RECURRENCE-ID を持つ(繰り返しの個別変更)
 *   - DTSTART が窓の前後1日以内
 * これによりメモリは「対象週ぶん＋繰り返し予定」に収まり、
 * カレンダーが何十MBあっても処理できる。
 */
export async function filterIcs(
  lines: AsyncIterable<string>,
  from: Date,
  to: Date,
  defaultTz = "Asia/Tokyo",
): Promise<{ ics: string; kept: number; scanned: number }> {
  const header: string[] = [];
  const kept: string[] = [];
  let block: string[] | null = null;
  let scanned = 0;
  let keptCount = 0;

  const pad = 24 * 3600 * 1000;
  const lo = from.getTime() - pad;
  const hi = to.getTime() + pad;

  for await (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      block = [line];
      continue;
    }
    if (block) {
      block.push(line);
      if (!upper.startsWith("END:VEVENT")) continue;

      scanned++;
      const unfolded = unfoldBlock(block);
      let relevant = false;
      let start: Date | null = null;
      for (const l of unfolded) {
        const u = l.toUpperCase();
        if (u.startsWith("RRULE") || u.startsWith("RECURRENCE-ID")) {
          relevant = true;
          break;
        }
        if (u.startsWith("DTSTART")) {
          const p = parseProp(l);
          if (p) start = parseIcsDate(p.value, p.params, defaultTz)?.date ?? null;
        }
      }
      if (!relevant && start) {
        const t = start.getTime();
        relevant = t >= lo && t <= hi;
      }
      if (relevant) {
        kept.push(...block);
        keptCount++;
      }
      block = null;
      continue;
    }
    // VEVENT の外側: カレンダー既定TZだけ拾う(VTIMEZONE本体は捨ててよい)
    if (upper.startsWith("X-WR-TIMEZONE") || upper.startsWith("X-WR-CALNAME")) header.push(line);
  }

  return {
    ics: ["BEGIN:VCALENDAR", "VERSION:2.0", ...header, ...kept, "END:VCALENDAR"].join("\r\n"),
    kept: keptCount,
    scanned,
  };
}

/* ------------------------------------------------------------------ */
/* 本体                                                                */
/* ------------------------------------------------------------------ */

interface RawEvent {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: IcsDateValue | null;
  end: IcsDateValue | null;
  rrule: RRule | null;
  exDates: number[];
  recurrenceId: number | null;
  cancelled: boolean;
  transparent: boolean;
}

/**
 * ICS本文を解析し、[from, to) の予定を(繰り返しを展開して)返す。
 * RECURRENCE-ID による個別変更は元の回を置き換え、EXDATE と STATUS:CANCELLED は除外する。
 */
export function parseIcs(text: string, from: Date, to: Date, defaultTz = "Asia/Tokyo"): IcsEvent[] {
  const lines = unfoldLines(text);
  const raws: RawEvent[] = [];
  let cur: RawEvent | null = null;
  let calTz = defaultTz;
  let depth = 0; // VTIMEZONE などの入れ子を飛ばすため

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      cur = {
        uid: "",
        summary: "",
        location: null,
        description: null,
        start: null,
        end: null,
        rrule: null,
        exDates: [],
        recurrenceId: null,
        cancelled: false,
        transparent: false,
      };
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (cur && cur.start) raws.push(cur);
      cur = null;
      continue;
    }
    if (!cur) {
      // カレンダー既定TZ(X-WR-TIMEZONE)。VTIMEZONE本体は読み飛ばす。
      if (upper.startsWith("BEGIN:VTIMEZONE")) depth++;
      if (upper.startsWith("END:VTIMEZONE")) depth--;
      if (depth === 0 && upper.startsWith("X-WR-TIMEZONE")) {
        const p = parseProp(line);
        if (p && isValidTz(p.value.trim())) calTz = p.value.trim();
      }
      continue;
    }

    const p = parseProp(line);
    if (!p) continue;
    switch (p.name) {
      case "UID":
        cur.uid = p.value;
        break;
      case "SUMMARY":
        cur.summary = unescapeText(p.value);
        break;
      case "LOCATION":
        cur.location = unescapeText(p.value) || null;
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(p.value).slice(0, 2000) || null;
        break;
      case "DTSTART":
        cur.start = parseIcsDate(p.value, p.params, calTz);
        break;
      case "DTEND":
        cur.end = parseIcsDate(p.value, p.params, calTz);
        break;
      case "RRULE":
        cur.rrule = parseRRule(p.value, calTz);
        break;
      case "EXDATE": {
        for (const v of p.value.split(",")) {
          const d = parseIcsDate(v, p.params, calTz);
          if (d) cur.exDates.push(d.date.getTime());
        }
        break;
      }
      case "RECURRENCE-ID": {
        const d = parseIcsDate(p.value, p.params, calTz);
        cur.recurrenceId = d ? d.date.getTime() : null;
        break;
      }
      case "STATUS":
        if (p.value.toUpperCase() === "CANCELLED") cur.cancelled = true;
        break;
      default:
        break;
    }
  }

  // RECURRENCE-ID を持つものは「その回の差し替え」
  const overrides = new Map<string, RawEvent>();
  for (const r of raws) {
    if (r.recurrenceId != null) overrides.set(`${r.uid}:${r.recurrenceId}`, r);
  }

  const out: IcsEvent[] = [];
  const seen = new Set<string>();

  const emit = (r: RawEvent, start: Date, durationMs: number) => {
    const key = `${r.uid}:${start.getTime()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      uid: r.uid,
      summary: (r.summary || "(タイトルなし)").slice(0, 200),
      startAt: r.start?.allDay ? null : start.toISOString(),
      endAt: r.start?.allDay ? null : new Date(start.getTime() + durationMs).toISOString(),
      date: jstDate(start),
      allDay: !!r.start?.allDay,
      location: r.location,
      description: r.description,
    });
  };

  for (const r of raws) {
    if (r.cancelled || !r.start) continue;
    const durationMs = r.end ? Math.max(0, r.end.date.getTime() - r.start.date.getTime()) : 60 * 60 * 1000;

    if (r.recurrenceId != null) {
      // 差し替え回そのもの
      if (r.start.date >= from && r.start.date < to) emit(r, r.start.date, durationMs);
      continue;
    }

    if (!r.rrule) {
      if (r.start.date >= from && r.start.date < to) emit(r, r.start.date, durationMs);
      continue;
    }

    const occurrences = expandRRule(r.start.date, r.rrule, from, to, calTz);
    for (const occ of occurrences) {
      if (r.exDates.includes(occ.getTime())) continue; // 個別削除
      const override = overrides.get(`${r.uid}:${occ.getTime()}`);
      if (override) continue; // 差し替え回は上で出力済み
      emit(r, occ, durationMs);
    }
  }

  return out.sort((a, b) => (a.date + (a.startAt ?? "")).localeCompare(b.date + (b.startAt ?? "")));
}
