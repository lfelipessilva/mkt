import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TikTokPerformanceItem } from "./types";
import { computeTopPerformanceItems } from "./components/PerformanceChart";

describe("PerformanceChart helpers (Issue #3)", () => {
  const mockItems: TikTokPerformanceItem[] = [
    {
      id: "p1",
      tiktok_post_id: "tp1",
      run_id: "r1",
      account_id: "acc_1",
      account_role: "single_woman",
      archetype_title: "Look Monocromático",
      tema: "Moda Verão",
      legenda: "Legenda 1",
      status: "published",
      tracking_mode: "manual",
      views: 10000,
      likes: 500,
      comments: 50,
      shares: 10,
      saves: 2,
    },
    {
      id: "p2",
      tiktok_post_id: "tp2",
      run_id: "r2",
      account_id: "acc_2",
      account_role: "single_man",
      archetype_title: "Look Trabalho",
      tema: null,
      legenda: "Legenda 2",
      status: "published",
      tracking_mode: "manual",
      views: 20000,
      likes: 1200,
      comments: 100,
      shares: 40,
      saves: 25,
    },
    {
      id: "p3",
      tiktok_post_id: "tp3",
      run_id: "r3",
      account_id: "acc_1",
      account_role: "single_woman",
      archetype_title: "Tendências Inverno",
      tema: "Inverno 2026",
      legenda: "Legenda 3",
      status: "published",
      tracking_mode: "manual",
      views: 5000,
      likes: 200,
      comments: 20,
      shares: 5,
      saves: 1,
    },
  ];

  it("sorts by views by default and limits to maxCount", () => {
    const top = computeTopPerformanceItems(mockItems, 2, "views");
    assert.equal(top.length, 2);
    assert.equal(top[0].id, "p2");
    assert.equal(top[0].value, 20000);
    assert.equal(top[0].percentage, 100);
    assert.equal(top[1].id, "p1");
    assert.equal(top[1].value, 10000);
    assert.equal(top[1].percentage, 50);
  });

  it("sorts by likes when requested", () => {
    const top = computeTopPerformanceItems(mockItems, 3, "likes");
    assert.equal(top[0].id, "p2");
    assert.equal(top[0].value, 1200);
    assert.equal(top[1].id, "p1");
    assert.equal(top[1].value, 500);
    assert.equal(top[2].id, "p3");
    assert.equal(top[2].value, 200);
  });

  it("handles empty array safely", () => {
    const top = computeTopPerformanceItems([], 5);
    assert.deepEqual(top, []);
  });
});
