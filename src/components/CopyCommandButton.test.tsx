// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyCommandButton } from "./CopyCommandButton";

afterEach(cleanup);

describe("CopyCommandButton", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a checkmark icon after copying, then returns to Copy login", async () => {
    render(<CopyCommandButton command="codex login" language="en" />);

    const button = screen.getByRole("button", { name: "Copy codex login" });
    expect(button).toHaveTextContent("Copy login");
    expect(button.querySelector("svg")).toBeNull();

    await act(async () => { button.click(); });

    expect(button).toHaveTextContent("Copied");
    expect(button.querySelector("svg")).not.toBeNull();

    act(() => { vi.advanceTimersByTime(1500); });

    expect(button).toHaveTextContent("Copy login");
    expect(button.querySelector("svg")).toBeNull();
  });

  it("shows Korean text and checkmark when language is ko", async () => {
    render(<CopyCommandButton command="claude auth login" language="ko" />);

    const button = screen.getByRole("button", { name: "claude auth login 복사" });
    expect(button).toHaveTextContent("로그인 복사");

    await act(async () => { button.click(); });

    expect(button).toHaveTextContent("복사됨");
    expect(button.querySelector("svg")).not.toBeNull();
  });
});
