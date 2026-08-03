-- =====================================================================
-- AI Lab: スライド作成（1スライド1画像 → PPTX統合）
--
--   デザインガイドと議事録を渡して、トンマナを揃えたスライドを連続生成する。
--   処理は3段に分かれる。
--     ① 構成案づくり（Claude）  … 何ページ目に何を載せるかを決める。ここで受講者が直せる
--     ② 画像生成（gpt-image-2）  … 1スライド1画像。ブラウザから1枚ずつ順に叩く
--     ③ PPTX統合                … 生成済み画像を1つのpptxにまとめる
--
--   ②を1リクエストにまとめない理由: 10枚で数分かかり、関数の実行時間上限(300秒)を超える。
--   1枚=1リクエストにすることで上限内に収まり、進捗表示と失敗した枚だけの再生成もできる。
--
--   受講者・会社の境界は ai_lab_* の他テーブルと同じくアプリ層(service_role)が担保する。
-- =====================================================================

create table if not exists public.ai_lab_slide_decks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid not null references ai_lab_companies(id) on delete cascade,
  user_id uuid not null references ai_lab_users(id) on delete cascade,
  title text not null default '無題のスライド',
  -- 受講者が書いた指示。構成案を作り直すときに再利用する。
  instruction text not null default '',
  -- 構成案づくりの段でClaudeが言語化したトンマナ。各スライドのプロンプトに毎回添える。
  style_guide text,
  -- 画像の品質。当面は medium 固定だが、将来の条件付き解放に備えて列で持つ。
  quality text not null default 'medium' check (quality in ('low','medium','high')),
  -- draft=構成案ができた / generating=画像生成中 / ready=全枚数そろった / failed=構成案づくりに失敗
  status text not null default 'draft' check (status in ('draft','generating','ready','failed')),
  error_code text,
  -- 統合後のpptx（ai_lab_attachments の generated 行）
  pptx_attachment_id uuid references ai_lab_attachments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_lab_slide_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  deck_id uuid not null references public.ai_lab_slide_decks(id) on delete cascade,
  -- 1始まりの並び順。構成案の編集で入れ替わりうる。
  position int not null,
  title text not null default '',
  -- 構成案の一覧に出す要点。画像には焼き込まれない補足。
  summary text,
  -- 画像生成に渡す文章。受講者が直接編集できる。
  image_prompt text not null default '',
  -- 発表者ノート。pptxのノート欄に入れる。
  notes text,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  attachment_id uuid references ai_lab_attachments(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deck_id, position)
);

create index if not exists idx_ai_lab_deck_user on public.ai_lab_slide_decks(user_id, created_at desc);
create index if not exists idx_ai_lab_deck_company on public.ai_lab_slide_decks(company_id, created_at desc);
create index if not exists idx_ai_lab_slide_deck on public.ai_lab_slide_items(deck_id, position);

-- 添付（デザインガイド・議事録）はデッキにも紐づける。
-- 会話に紐づく前提の message_id だけだと、スライド作成の添付が孤児として掃除されてしまう。
alter table public.ai_lab_attachments
  add column if not exists deck_id uuid references public.ai_lab_slide_decks(id) on delete cascade;

create index if not exists idx_ai_lab_att_deck on public.ai_lab_attachments(deck_id);

-- 孤児掃除の索引を、デッキに紐づいたものも除外する形に貼り直す。
drop index if exists idx_ai_lab_att_orphan;
create index if not exists idx_ai_lab_att_orphan on public.ai_lab_attachments(created_at)
  where message_id is null and deck_id is null;

alter table public.ai_lab_slide_decks enable row level security;
alter table public.ai_lab_slide_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ai_lab_slide_decks','ai_lab_slide_items'] loop
    execute format('drop policy if exists %I_admin_all on public.%I', t, t);
    execute format(
      'create policy %I_admin_all on public.%I for all '
      'using (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in (''owner'',''admin'')) '
      'with check (tenant_id in (select current_tenant_ids()) and current_role_in(tenant_id) in (''owner'',''admin''))',
      t, t);
  end loop;
end $$;
