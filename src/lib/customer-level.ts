/** 顧客レベル(規模帯)の定義。仮: 従業員規模ベース。後でランク併用や閾値調整可。 */
export const SIZE_BANDS: { key: string; label: string; short: string }[] = [
  { key: "enterprise", label: "エンプラ (1000名〜)", short: "エンプラ" },
  { key: "mid", label: "中堅 (100〜1000名)", short: "中堅" },
  { key: "smb", label: "SMB (〜100名)", short: "SMB" },
  { key: "unknown", label: "不明", short: "不明" },
];
