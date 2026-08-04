-- =====================================================================
-- 0202: 担当者(タレント)の所属会社 と 月次請求サマリー
--   タレント台帳・稼働報告に「どこの会社所属か」が無く、会社ごとの
--   月末請求額が把握できなかった。担当者は必ず所属区分を持ち、
--   「個人事業主のため個人」も所属の一形態として扱う。
--
--   モデル:
--     talent_companies(所属会社=請求元マスタ)
--       └ talents.company_id            所属会社(affiliation_type='company'のとき必須)
--          talents.affiliation_type      company / individual(個人事業主) / unset(未設定)
--          talents.tax_rate              個人事業主の消費税率(%)。null=既定10%
--
--   既存行は 'unset'(未設定)から始まり、UI側で未設定件数を警告して
--   埋めてもらう。勝手に「個人」と決めつけない。
-- =====================================================================

-- ---- 所属会社(請求元)マスタ ----
create table if not exists public.talent_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,                                -- 所属会社名(請求元)
  billing_name text,                                 -- 請求書上の名義(会社名と異なる場合)
  invoice_no text,                                   -- インボイス登録番号(T+13桁)
  tax_rate numeric not null default 10,              -- 消費税率(%)。免税事業者は0
  payment_terms text,                                -- 締め・支払サイト(例: 月末締め翌月末払い)
  contact_email text,                                -- 請求・支払の連絡先
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 同一テナント内で会社名の重複を防ぐ(表記ゆれで請求先が割れると集計が壊れるため)
create unique index if not exists uq_talent_companies_name on public.talent_companies(tenant_id, lower(name));
create index if not exists idx_talent_companies_tenant on public.talent_companies(tenant_id);
drop trigger if exists trg_talent_companies_updated on public.talent_companies;
create trigger trg_talent_companies_updated before update on public.talent_companies
  for each row execute function public.set_updated_at();

-- ---- タレント側の所属 ----
-- on delete restrict: 所属者が残っている会社は消せない(請求集計の欠落を防ぐ)
alter table public.talents add column if not exists company_id uuid references talent_companies(id) on delete restrict;
alter table public.talents add column if not exists affiliation_type text not null default 'unset';
alter table public.talents add column if not exists tax_rate numeric;  -- 個人事業主の消費税率(%)。null=既定10%

alter table public.talents drop constraint if exists chk_talents_affiliation;
alter table public.talents add constraint chk_talents_affiliation check (
  affiliation_type in ('company', 'individual', 'unset')
  and (affiliation_type <> 'company' or company_id is not null)
);
create index if not exists idx_talents_company on public.talents(company_id);

-- ---- RLS ----
-- 台帳の管理は人事。案件管理職(請求サマリー・稼働実績一覧)は参照のみ。
alter table public.talent_companies enable row level security;

drop policy if exists talent_companies_all on public.talent_companies;
create policy talent_companies_all on public.talent_companies for all
  using (tenant_id in (select current_tenant_ids()) and is_hr(tenant_id))
  with check (tenant_id in (select current_tenant_ids()) and is_hr(tenant_id));

drop policy if exists talent_companies_select_project_mgr on public.talent_companies;
create policy talent_companies_select_project_mgr on public.talent_companies for select
  using (tenant_id in (select project_mgr_tenant_ids()));
