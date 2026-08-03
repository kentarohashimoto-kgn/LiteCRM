import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { verifyBasicCredentials } from "@/lib/ai-lab/basic-auth";
import { getEdgeCompany } from "@/lib/ai-lab/edge-company";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * AI Lab(/lab/{slug})の一次ゲート: 会社ごとの HTTP Basic 認証。
 *
 * ここで見るのは「その会社の環境に触れてよいか」だけで、本人認証は
 * /lab/{slug}/login の個別ログインが担う。CRM(Supabase Auth)のセッションは一切参照しない。
 * 存在しない会社・無効化された会社は 401 ではなく 404 にする(会社の有無を外から探れないように)。
 */
async function labGate(request: NextRequest, path: string): Promise<NextResponse> {
  const notFound = new NextResponse("Not Found", { status: 404 });
  const slug = path.split("/")[2];
  if (!slug) return notFound;

  const result = await getEdgeCompany(slug);
  // 環境変数の設定漏れは「会社が無い」と紛らわしいので、切り分けできる応答にする。
  if (result.kind === "not_configured") {
    return new NextResponse(
      "AI体験環境が未設定です。NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  if (result.kind === "not_found" || !result.company.is_active) return notFound;
  const company = result.company;

  const ok = await verifyBasicCredentials(
    request.headers.get("authorization"),
    company.basic_user,
    company.basic_secret_hash,
  );
  if (!ok) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="AI Lab", charset="UTF-8"' },
    });
  }
  return NextResponse.next({ request });
}

/**
 * 各リクエストで Supabase セッションをリフレッシュし、Cookie を更新する。
 * 未ログインで /app 配下にアクセスした場合は /login にリダイレクトする。
 */
export async function middleware(request: NextRequest) {
  // /lab は顧客向けの体験環境。CRMの認証系とは独立して処理する。
  // 前方一致にしないのは、将来 /labor のような別ルートを巻き込まないため。
  const path = request.nextUrl.pathname;
  if (path === "/lab" || path.startsWith("/lab/")) {
    return labGate(request, path);
  }
  // AI Lab のAPIは受講者セッション(ailab_session)で認可する。
  // CRMのセッション更新は不要なので、ストリーミング要求に余計な往復を足さない。
  if (request.nextUrl.pathname.startsWith("/api/lab/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase 未設定時はそのまま通す(セットアップ前の保護)。
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // /help 配下はヘルプ資料(静的HTML)。社内向けのためログイン必須にする。
  const isAppRoute = path.startsWith("/app") || path.startsWith("/help");
  const isLogin = path === "/login";

  if (!user && isAppRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }
  if (user && isLogin) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/app/mypage";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
