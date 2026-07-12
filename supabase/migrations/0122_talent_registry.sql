-- =====================================================================
-- 0122: タレント台帳の拡張（アクティブ人材台帳のCRM化）
--   役職・部署・役割・レイヤー・契約ステータス・連絡先・時給を追加。
--   成功報酬や特殊な原価扱いのメンバーを除外できるよう
--   「原価管理対象」フラグ(cost_managed)を持つ。
--   employment_type は既存の employee/contractor/instructor に加えて
--   company(開発会社・代理店等の企業)を許容する(text列・制約なし)。
-- =====================================================================

alter table public.talents add column if not exists title text;              -- 役職
alter table public.talents add column if not exists department text;         -- 部署(仮部署: 総務/営業/講師/開発/人事 等)
alter table public.talents add column if not exists role_text text;          -- 役割(営業、コンサル、講師 等)
alter table public.talents add column if not exists layer text;              -- レイヤー(FS/IS/部長/所属先 等)
alter table public.talents add column if not exists contract_status text not null default '継続';  -- 継続/保留/ほぼ解約/解約/Ｘジム/パフォ悪 等
alter table public.talents add column if not exists email text;              -- 連絡先メール
alter table public.talents add column if not exists mail_system text;        -- メール種別(GWS/Zoho/なし)
alter table public.talents add column if not exists hourly_rate numeric;     -- 時給(円)
alter table public.talents add column if not exists cost_managed boolean not null default true;  -- 原価管理対象(成功報酬等はfalse)
