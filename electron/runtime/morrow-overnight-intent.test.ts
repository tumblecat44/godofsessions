import { describe, expect, it } from "vitest";
import { isOvernightPreparationRequest } from "./morrow-service";

describe("Overnight preparation intent", () => {
  it.each([
    "Overnight를 준비해줘",
    "오늘 밤 무인 실행으로 맡길 일을 판단해줘",
    "자리를 비운 동안 처리할 일을 추천해줘",
    "Plan bounded unattended work",
    "Plan repository work for tonight",
  ])("recognizes a read-only preparation request: %s", (text) => {
    expect(isOvernightPreparationRequest(text)).toBe(true);
  });

  it.each([
    "오늘 저녁 메뉴를 추천해줘",
    "Run the test now",
    "일반 대화를 계속하자",
  ])("does not classify unrelated conversation as Overnight preparation: %s", (text) => {
    expect(isOvernightPreparationRequest(text)).toBe(false);
  });
});
