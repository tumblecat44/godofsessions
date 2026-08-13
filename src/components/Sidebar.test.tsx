// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

describe("V2 navigation", () => {
  it("keeps only Ask Morrow and Settings from the V1 sidebar", () => {
    render(<Sidebar view="chat" language="en" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Ask Morrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    for (const removed of ["Control board", "Overnight", "Session inbox", "Session sources", "All sessions"]) {
      expect(screen.queryByText(removed, { exact: false })).not.toBeInTheDocument();
    }
  });
});
