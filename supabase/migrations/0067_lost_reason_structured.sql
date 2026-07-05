-- C-4 失注理由の構造化: 自由文(lost_reason)に加えて選択式コード＋競合名を持たせ、
-- 失注分析(理由別・競合別・月別)を可能にする。コードの選択肢はアプリ側定数(LOST_REASONS)。
--   price / timing / competitor / needs_mismatch / budget_freeze / no_response / internal / other
alter table public.opportunities
  add column if not exists lost_reason_code text,
  add column if not exists lost_competitor text;

comment on column public.opportunities.lost_reason_code is '失注理由コード(price/timing/competitor/needs_mismatch/budget_freeze/no_response/internal/other)';
comment on column public.opportunities.lost_competitor is '負けた競合名(競合起因のとき)';

create index if not exists idx_opps_lost_reason
  on public.opportunities(tenant_id, lost_reason_code) where status = 'lost';
