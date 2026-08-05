/**
 * 会社名の表記ゆれ吸収(companySearchKey / matchesCompanyQuery)の回帰テスト。
 *
 * ここで固定した規則は DB 側 `public.company_search_key(text)`(0203) と同一。
 * どちらかを変えるときは両方を揃えること。
 */
import { describe, expect, it } from "vitest";
import { companySearchFilter, companySearchKey, matchesCompanyQuery } from "@/lib/company-name";

describe("companySearchKey", () => {
  it("法人格の位置・表記に関わらず同じキーになる", () => {
    const variants = [
      "株式会社カトルセ",
      "カトルセ株式会社",
      "カトルセ",
      "㈱カトルセ",
      "（株）カトルセ",
      "(株)カトルセ",
      "株式会社 カトルセ",
      "株式会社　カトルセ", // 全角スペース
      "カトルセ(株)",
    ];
    for (const v of variants) expect(companySearchKey(v)).toBe("カトルセ");
  });

  it("半角カタカナ・ひらがな・濁点の分離を吸収する", () => {
    expect(companySearchKey("ｶﾄﾙｾ")).toBe("カトルセ");
    expect(companySearchKey("かとるせ")).toBe("カトルセ");
    expect(companySearchKey("ﾌﾞﾘｯｸｲﾝ")).toBe("ブリックイン"); // ﾌ+ﾞ の合成
    expect(companySearchKey("有限会社ﾌﾞﾘｯｸｲﾝ福井")).toBe("ブリックイン福井");
  });

  it("英字は小文字化し、英語の法人格も除去する", () => {
    expect(companySearchKey("CATORCE Co., Ltd.")).toBe("catorce");
    expect(companySearchKey("Catorce Inc.")).toBe("catorce");
    expect(companySearchKey("catorce k.k.")).toBe("catorce");
    expect(companySearchKey("Ａ＆Ｂ商事")).toBe("ab商事"); // 全角英記号→半角→記号除去
  });

  it("英単語の一部を法人格と誤認しない", () => {
    expect(companySearchKey("Incheon")).toBe("incheon");
    expect(companySearchKey("Corporate Design")).toBe("corporatedesign");
  });

  it("法人格だけの入力はキーが空になる(全件ヒット防止)", () => {
    expect(companySearchKey("株式会社")).toBe("");
    expect(companySearchKey("　（株）　")).toBe("");
    expect(companySearchKey("")).toBe("");
    expect(companySearchKey(null)).toBe("");
    expect(companySearchKey(undefined)).toBe("");
  });

  it("中黒・長音符・記号を無視する", () => {
    expect(companySearchKey("カトルセ・ジャパン")).toBe("カトルセジャパン");
    expect(companySearchKey("コーヒー")).toBe(companySearchKey("コヒ"));
    expect(companySearchKey("日本ﾎﾟﾘｴｽﾃﾙ(株)")).toBe("日本ポリエステル");
  });

  it("LIKE のワイルドカードは正規化キーに残らない", () => {
    expect(companySearchKey("%_カトルセ%")).toBe("カトルセ");
  });
});

describe("matchesCompanyQuery", () => {
  it("検索語に法人格が付いていてもデータ側が素の社名ならヒットする", () => {
    expect(matchesCompanyQuery("カトルセ", "株式会社カトルセ")).toBe(true);
    expect(matchesCompanyQuery("カトルセ", "㈱カトルセ")).toBe(true);
    expect(matchesCompanyQuery("カトルセ", "ｶﾄﾙｾ")).toBe(true);
  });

  it("データ側に法人格が付いていても素の社名でヒットする", () => {
    expect(matchesCompanyQuery("株式会社カトルセ", "カトルセ")).toBe(true);
    expect(matchesCompanyQuery("有限会社ブリックイン福井", "ブリックイン")).toBe(true);
  });

  it("部分一致は従来どおり効く", () => {
    expect(matchesCompanyQuery("株式会社カトルセ / AI研修", "カトルセ")).toBe(true);
    expect(matchesCompanyQuery("CATORCE Co., Ltd.", "catorce")).toBe(true);
  });

  it("無関係な社名にはヒットしない", () => {
    expect(matchesCompanyQuery("株式会社アークサイド", "カトルセ")).toBe(false);
  });

  it("法人格だけの検索語は生の部分一致だけで判定する(全件ヒットしない)", () => {
    expect(matchesCompanyQuery("株式会社カトルセ", "株式会社")).toBe(true);
    expect(matchesCompanyQuery("カトルセ", "株式会社")).toBe(false);
  });

  it("空の検索語は全件通す", () => {
    expect(matchesCompanyQuery("カトルセ", "")).toBe(true);
    expect(matchesCompanyQuery(null, "  ")).toBe(true);
  });
});

describe("companySearchFilter", () => {
  it("生の ilike と正規化キーの like を OR する", () => {
    expect(companySearchFilter(["name"], "株式会社カトルセ")).toBe(
      "name.ilike.%株式会社カトルセ%,search_key.like.%カトルセ%",
    );
    expect(companySearchFilter(["company_name", "contact_name"], "カトルセ")).toBe(
      "company_name.ilike.%カトルセ%,contact_name.ilike.%カトルセ%,search_key.like.%カトルセ%",
    );
  });

  it("法人格だけの検索語は生の ilike だけを出す", () => {
    expect(companySearchFilter(["name"], "株式会社")).toBe("name.ilike.%株式会社%");
  });

  it("空の検索語は null(絞り込みなし)", () => {
    expect(companySearchFilter(["name"], "")).toBeNull();
    expect(companySearchFilter(["name"], "   ")).toBeNull();
  });

  it("or() の構文を壊すメタ文字は除去され、キー側にも残らない", () => {
    expect(companySearchFilter(["name"], "カト,ルセ(%_)")).toBe(
      "name.ilike.%カト ルセ%,search_key.like.%カトルセ%",
    );
  });

  it("記号だけの入力は全件ではなく0件になる条件を返す", () => {
    expect(companySearchFilter(["name"], "()")).toBe("id.is.null");
  });
});
