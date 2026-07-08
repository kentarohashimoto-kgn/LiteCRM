import { describe, it, expect } from "vitest";
import { canReassignOwner, REASSIGN_ROLES } from "@/lib/constants";
import type { Role } from "@/lib/types";

describe("canReassignOwner", () => {
  it("代表・管理者・Sales Opsのみ担当者を再割当てできる", () => {
    expect(canReassignOwner("owner")).toBe(true);
    expect(canReassignOwner("admin")).toBe(true);
    expect(canReassignOwner("sales_manager")).toBe(true);
  });

  it("営業担当・外部営業・その他は再割当て不可", () => {
    const denied: Role[] = ["sales_rep", "external_sales", "partner", "delivery", "finance", "back_office", "hr", "viewer"];
    for (const r of denied) expect(canReassignOwner(r)).toBe(false);
  });

  it("REASSIGN_ROLESは3ロール(過剰付与の検知)", () => {
    expect([...REASSIGN_ROLES].sort()).toEqual(["admin", "owner", "sales_manager"]);
  });
});
