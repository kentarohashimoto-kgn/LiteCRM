-- 0138_hr_recruiting_expansion.sql
-- BO-5 HR拡張: 求人案件・候補者の入力項目拡張、候補者↔求人 多対多、
--   選考履歴(interviews)の定性項目、候補者の書類添付(attachments)対応。
-- ロールバック手順は各ブロック末尾のコメント参照。

-- ============================================================
-- job_openings 追加カラム
-- ============================================================
alter table public.job_openings
  -- 共通
  add column if not exists headcount numeric(4,1),        -- 募集人数(小数点1桁)
  add column if not exists priority text,                 -- high/mid/low
  add column if not exists close_reason text,             -- 充足/一時停止/顧客都合で終了/他社決定/採用中止/対応見送り/その他
  add column if not exists work_style text,               -- 勤務形態(clientは出社条件も含む)
  -- カトルセ人員(internal)専用
  add column if not exists employment_types text[],       -- 業務委託/正社員/アルバイト(複数)
  add column if not exists workload text,                 -- 稼働量
  add column if not exists pay_rate text,                 -- 報酬単価
  add column if not exists start_on date,                 -- 開始時期
  add column if not exists required_skills text,          -- 必要スキル
  add column if not exists recruit_channel text,          -- 採用チャネル
  -- クライアント案件(client)専用
  add column if not exists end_client text,               -- エンドクライアント
  add column if not exists upstream_company text,         -- 上位会社・紹介元
  add column if not exists distribution text,             -- 商流(個人事業主可否含む)
  add column if not exists client_rate text,              -- 顧客提示単価
  add column if not exists pay_limit text,                -- 人材への支払上限
  add column if not exists expected_margin text,          -- 想定粗利
  add column if not exists settlement_terms text,         -- 精算幅・精算条件
  add column if not exists payment_site text,             -- 支払いサイト
  add column if not exists interview_count text,          -- 面談回数
  add column if not exists project_start_on date,         -- 案件開始日
  add column if not exists project_end_on date;           -- 終了予定日

-- ステータス整理(募集中/選考中/クローズ の3種へ)。旧 'filled'(充足) は closed+理由へ移行。
update public.job_openings
  set status = 'closed', close_reason = coalesce(close_reason, '充足')
  where status = 'filled';

-- ============================================================
-- candidates 追加カラム(基本情報の拡充)
-- ============================================================
alter table public.candidates
  add column if not exists furigana text,                 -- フリガナ
  add column if not exists phone text,                    -- 電話番号
  add column if not exists area text,                     -- 居住地域
  add column if not exists desired_conditions text,       -- 希望・稼働条件
  add column if not exists desired_contract text,         -- 希望契約形態
  add column if not exists available_from text,           -- 稼働可能時期
  add column if not exists desired_workload text,         -- 希望稼働量
  add column if not exists desired_pay text,              -- 希望単価・報酬
  add column if not exists work_location_pref text,       -- 出社・リモート条件
  add column if not exists skills text;                   -- スキル情報
-- 既存 notes を「メモ」として流用。

-- ============================================================
-- candidate_openings（候補者↔求人 多対多。講師＆営業など複数紐付け）
-- ============================================================
create table if not exists public.candidate_openings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  job_opening_id uuid not null references job_openings(id) on delete cascade,
  role_note text,                                          -- 任意(例: 講師/営業)
  created_at timestamptz not null default now(),
  unique (candidate_id, job_opening_id)
);
create index if not exists idx_candidate_openings_cand on public.candidate_openings(candidate_id);
create index if not exists idx_candidate_openings_open on public.candidate_openings(job_opening_id);

alter table public.candidate_openings enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'candidate_openings' and policyname = 'candidate_openings_all'
  ) then
    create policy candidate_openings_all on public.candidate_openings for all
      using (tenant_id in (select current_tenant_ids()) and is_hr(tenant_id))
      with check (tenant_id in (select current_tenant_ids()) and is_hr(tenant_id));
  end if;
end $$;

-- 既存 candidates.job_opening_id を join表へ移行(後方互換でカラム自体は残置)。
insert into public.candidate_openings (tenant_id, candidate_id, job_opening_id)
  select tenant_id, id, job_opening_id
  from public.candidates
  where job_opening_id is not null
on conflict (candidate_id, job_opening_id) do nothing;

-- ============================================================
-- interviews（選考履歴）追加カラム(定性評価)
-- ============================================================
alter table public.interviews
  add column if not exists good_points text,              -- 良かった点
  add column if not exists concerns text,                 -- 懸念点
  add column if not exists next_action text,              -- 次回アクション
  add column if not exists next_action_due date;          -- 次回対応期限
-- result に 'declined'(辞退) を追加。result は text 制約なしのためDDL不要(UI選択肢のみ追加)。

-- ============================================================
-- attachments: 候補者(candidate)の書類添付を可能に
-- ============================================================
alter table public.attachments drop constraint if exists attachments_target_type_check;
alter table public.attachments add constraint attachments_target_type_check
  check (target_type in ('opportunity', 'account', 'candidate'));

-- RLS: can_edit_role は hr を含まない(0002_rls.sql)。HRロールが候補者添付を
-- insert/delete できるよう、target_type='candidate' のとき is_hr を許可。
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert
  with check (
    tenant_id in (select current_tenant_ids())
    and (can_edit_role(tenant_id) or (target_type = 'candidate' and is_hr(tenant_id)))
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete
  using (
    tenant_id in (select current_tenant_ids())
    and (
      uploaded_by = auth.uid()
      or current_role_in(tenant_id) in ('owner', 'admin')
      or (target_type = 'candidate' and is_hr(tenant_id))
    )
  );

-- ============================================================
-- ロールバック(down):
--   drop table if exists public.candidate_openings;
--   alter table public.job_openings drop column if exists headcount, ... (追加各カラム);
--   alter table public.candidates drop column if exists furigana, ... (追加各カラム);
--   alter table public.interviews drop column if exists good_points, concerns, next_action, next_action_due;
--   attachments: check制約とinsert/deleteポリシーを ('opportunity','account') / 元定義へ戻す。
-- ============================================================
