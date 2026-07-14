---
name: sales-meeting-lookup
description: >
  Find a specific 商談/meeting and its tldv recording/transcript when the user
  refers to it by CLIENT COMPANY NAME (e.g. "昨日のコナカとの商談の議事録")
  but a direct tldv keyword search on that company returns nothing. This
  happens for appointments arranged by アポ代行 partners (especially ビジネスタンク /
  Business Tank), whose calendar titles do NOT contain the client company name.
  Use this to reliably locate the right recording by cross-referencing the
  CATORCE CRM appointment schedule, the tldv calendar, and Gmail/booking
  descriptions. Triggers: 商談を探す, 議事録要約を作る, tldv 文字起こし, アポ, コナカ など
  会社名で商談を指定されたが tldv 検索でヒットしない場合。
---

# Sales meeting lookup (CRM × tldv × Gmail)

## Problem this solves

The user asks for a meeting by **client company name** (e.g. "コナカとの商談"),
but `tldv search-meetings query:"コナカ"` returns **0 results**.

**Root cause:** Appointments booked by アポ代行 partners — most notably
**ビジネスタンク (Business Tank)** — are scheduled under the coordinator's name,
so the calendar/tldv title looks like:

> `㈱カトルセ｜予約スケジュール (斉藤純)`

…with an invitee such as `j-saito@race-number.co.jp`. **The client company
name never appears in the title** — it lives only in the booking description
and in the CRM appointment schedule.

## Lookup procedure

Do these in parallel, then reconcile by **date + time**:

1. **CRM appointment schedule = source of truth for company↔time.**
   In `catorce-sales-os` (Supabase project `beztpddkezjlrlixjjqq`) the appointment
   list shows entries like **"9:00〜コナカ"**. Query `opportunities.appointment_at`
   (and `accounts.name`), or the `meetings` / `sales_schedules` tables, filtered
   to the target date to get the **company name and its time slot**.

   ```sql
   -- who am I meeting, and when, on a given day
   select a.name as company, o.name as opp, o.appointment_at
   from opportunities o
   join accounts a on a.id = o.account_id
   where o.appointment_at::date = '2026-07-14'
   order by o.appointment_at;
   ```

2. **tldv = the recording/transcript.** List meetings for that date with
   `search-meetings` (NO company query — it won't match). Match the meeting whose
   `happenedAt` equals the CRM time slot. For BT appointments the invitee domain
   is **`race-number.co.jp`** (Business Tank) and the title is
   `㈱カトルセ｜予約スケジュール (<予約者名>)`.
   - Remember `happenedAt` is **UTC**; JST = UTC + 9h. A 9:00 JST appointment is
     `...T00:00:00.000Z`.

3. **Gmail / booking description = confirmation + context.** The BT reminder
   email (`from: matching-support@business-tank.co.jp`, subject contains
   「商談開始」/会社名) and the booking コメント contain the client company name,
   企業概要, 先方対応者, and 先方ニーズ. Use these to confirm the match and to enrich
   the 議事録 (attendees, needs) before writing the summary.

## Known aliases / identifiers

- **ビジネスタンク (Business Tank)** — アポ代行. Booking domain: `race-number.co.jp`
  (Zoom: `race.zoom.us`). Coordinator seen: 斉藤純 `j-saito@race-number.co.jp`.
- tldv BT appointment title pattern: `㈱カトルセ｜予約スケジュール (<name>)`.

## Building the 議事録要約

- Prefer `get-meeting-notes`; if its markdown body is empty, pull
  `get-meeting-transcript` and summarize from that.
- Cross-reference the booking description (企業概要・先方ニーズ・先方対応者) so the
  summary header has correct company, attendees, and stated needs.
- Structure: 日時/参加者/経路 → 先方の状況・ニーズ → 当社の提案 → 費用感 →
  **ネクストアクション（誰が何を）**. End with 橋本さんのTODO（提案書/見積の送付など）.
