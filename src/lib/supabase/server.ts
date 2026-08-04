import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * サーバー(RSC / Server Actions / Route Handlers)用の Supabase クライアント。
 * ログインユーザーのセッションで動作し、RLS が自動適用される。
 *
 * Next 15 で cookies() は Promise を返すようになったが、この関数自体は同期のまま保つ。
 * @supabase/ssr の cookie ハンドラは非同期を許容する(GetAllCookies の戻り値が
 * Promise でもよい)ので、await はハンドラの内側に閉じ込める。
 * こうしないと呼び出し側 598 箇所すべてに await が波及する。
 */
export function getSupabaseServer() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          return (await cookies()).getAll();
        },
        async setAll(cookiesToSet: CookieToSet[]) {
          try {
            const cookieStore = await cookies();
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // RSC からの呼び出しでは set 不可。middleware 側でリフレッシュするため無視。
          }
        },
      },
    },
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
