/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // クライアントのRouter Cacheを延長し、再訪問(メニュー往復)を即時表示にする。
    // 書き込み時は server action の revalidate で無効化されるため、受動的な遷移のみ対象。
    staleTimes: {
      dynamic: 180, // 動的ページを180秒キャッシュ(従来は実質0〜30秒)
      static: 300,
    },
  },
};

export default nextConfig;
