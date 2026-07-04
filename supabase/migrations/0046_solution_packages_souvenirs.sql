-- お土産ソリューション: カタログ(solution_packages)＋顧客別のお土産候補/反応/提案(account_souvenirs)。
-- 要件書4.6の5パッケージをシード。既存客アップセル時に候補を事前設定し、反応を見て提案を選ぶ。

create table if not exists public.solution_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  package_name text not null,
  package_category text not null,       -- elearning/chatbot/suishin/it_solution/development/other
  target_customer text,
  customer_benefit text not null,
  proposal_timing text,
  next_expansion text,
  standard_price numeric,
  sales_script text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.solution_packages enable row level security;
create policy sp_select on public.solution_packages for select
  using (tenant_id = any(array(select current_tenant_ids())));
create policy sp_insert on public.solution_packages for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy sp_update on public.solution_packages for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy sp_delete on public.solution_packages for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create trigger set_updated_at_solution_packages before update on public.solution_packages
  for each row execute function public.set_updated_at();

-- 5パッケージをテナントごとにシード（既にあればスキップ）
insert into public.solution_packages (tenant_id, package_name, package_category, target_customer, customer_benefit, proposal_timing, next_expansion)
select t.id, p.name, p.cat, p.target, p.benefit, p.timing, p.expansion
from public.tenants t
cross join (values
  ('AI学習eラーニング','elearning','研修受講企業・社内展開したい企業・人事/研修部門','研修アーカイブ＋最新活用ノウハウ動画を毎月学習できる','研修提案時・研修最終日・研修後30日以内','LMS/回答AIチャットボット/AI顧問/全社教育'),
  ('AI回答チャットボット/サポートデスク','chatbot','研修後にAI活用を定着させたい企業・問い合わせが多い企業','AI活用方法をいつでも質問できる。社内問い合わせ対応にも拡張可能','研修後・情シス/人事/DX部門への提案時','有人サポートデスク/社内FAQ/RAG/Dify開発'),
  ('AIエージェント SUISHIN','suishin','研修後に実務実装したい企業・営業/情シス/DX推進部門','問合せボット・提案書作成・レビューアーAIで実務を推進(7月末ローンチ)','研修後・実装検討時','部門展開/月額利用/開発保守'),
  ('情報システム向けAIソリューションパック','it_solution','情報システム部・DX推進部・IT企画部','AI研修+問合せボット+法人品質バイブコーディング研修(CTCSP協業予定)','情シス提案時','情シス向け顧問/サポートデスク/AI開発支援'),
  ('AI活用システム開発・保守','development','個別業務をAI化したい企業・PoC後に本番化したい企業','AIを実業務に組み込み継続的に改善できる','研修後・顧問中・PoC後・課題ヒアリング後','保守契約/AI顧問/追加開発')
) as p(name, cat, target, benefit, timing, expansion)
where not exists (select 1 from public.solution_packages sp where sp.tenant_id = t.id);

-- 顧客別のお土産候補・反応・提案状況
create table if not exists public.account_souvenirs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  package_id uuid not null references public.solution_packages(id),
  status text not null default 'candidate',  -- candidate(候補)/presented(提示済)/proposed(提案する)/declined(見送り)
  customer_reaction text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_souvenirs enable row level security;
create policy asv_select on public.account_souvenirs for select
  using (tenant_id = any(array(select current_tenant_ids())));
create policy asv_insert on public.account_souvenirs for insert
  with check (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy asv_update on public.account_souvenirs for update
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create policy asv_delete on public.account_souvenirs for delete
  using (tenant_id = any(array(select current_tenant_ids())) and can_edit_role(tenant_id));
create trigger set_updated_at_account_souvenirs before update on public.account_souvenirs
  for each row execute function public.set_updated_at();
create index if not exists idx_account_souvenirs_account on public.account_souvenirs(tenant_id, account_id);
