import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearEdgeCompanyCache, getEdgeCompany } from "@/lib/ai-lab/edge-company";

const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIG_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORIG_FETCH = globalThis.fetch;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  clearEdgeCompanyCache();
});
afterEach(() => {
  restore("NEXT_PUBLIC_SUPABASE_URL", ORIG_URL);
  restore("SUPABASE_SERVICE_ROLE_KEY", ORIG_KEY);
  globalThis.fetch = ORIG_FETCH;
  clearEdgeCompanyCache();
});

const COMPANY = {
  id: "c1",
  slug: "acme",
  is_active: true,
  basic_user: "acme",
  basic_secret_hash: "deadbeef",
};

function stubFetch(rows: unknown[], calls: { n: number }) {
  globalThis.fetch = (async () => {
    calls.n++;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("middleware から引く会社情報", () => {
  it("環境変数が未設定なら not_configured（会社なしと区別する）", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(await getEdgeCompany("acme")).toEqual({ kind: "not_configured" });
  });

  it("該当スラッグが無ければ not_found", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const calls = { n: 0 };
    stubFetch([], calls);
    expect(await getEdgeCompany("nope")).toEqual({ kind: "not_found" });
  });

  it("見つかれば会社を返し、TTL内は再取得しない", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const calls = { n: 0 };
    stubFetch([COMPANY], calls);

    expect(await getEdgeCompany("acme")).toEqual({ kind: "ok", company: COMPANY });
    expect(await getEdgeCompany("acme")).toEqual({ kind: "ok", company: COMPANY });
    expect(calls.n).toBe(1);
  });

  it("通信断でも例外を投げず、キャッシュがあればそれを使う", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const calls = { n: 0 };
    stubFetch([COMPANY], calls);
    await getEdgeCompany("acme");

    clearEdgeCompanyCache();
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect(await getEdgeCompany("acme")).toEqual({ kind: "not_found" });
  });
});
