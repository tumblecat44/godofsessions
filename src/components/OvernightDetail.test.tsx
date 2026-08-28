// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OvernightCard, OvernightGenerationId, OvernightId, OvernightLocalDate } from "../shared/contracts";
import { OvernightDetail } from "./OvernightDetail";

afterEach(() => {
  cleanup();
});

function card(overrides: Partial<OvernightCard> = {}): OvernightCard {
  return {
    id: "card-1" as OvernightId,
    generationId: "gen-1" as OvernightGenerationId,
    localDate: "2026-08-28" as OvernightLocalDate,
    status: "candidate",
    goal: "Fix the hover",
    finishCondition: "Hover works in the board",
    workAi: "codex",
    verifyAi: "claude",
    stallHours: 1,
    decisionsLog: [
      { at: "2026-08-28T21:00:00.000Z", kind: "proposed", note: "key-1" },
    ],
    createdAt: "2026-08-28T21:00:00.000Z",
    updatedAt: "2026-08-28T21:00:00.000Z",
    ...overrides,
  };
}

describe("OvernightDetail", () => {
  it("saves editable candidate fields and keeps status candidate", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<OvernightDetail card={card()} index={0} language="en" onSave={onSave} onDelete={vi.fn(async () => undefined)} />);

    fireEvent.change(screen.getByDisplayValue("Fix the hover"), { target: { value: "Fix the focus ring" } });
    fireEvent.change(screen.getByDisplayValue("Hover works in the board"), { target: { value: "Focus ring is visible" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      goal: "Fix the focus ring",
      finishCondition: "Focus ring is visible",
      workAi: "codex",
      verifyAi: "claude",
      stallHours: 1,
    }));
  });

  it("refuses an empty goal without calling save", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<OvernightDetail card={card()} index={0} language="en" onSave={onSave} onDelete={vi.fn(async () => undefined)} />);

    fireEvent.change(screen.getByDisplayValue("Fix the hover"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Goal cannot be empty.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("deletes a candidate", async () => {
    const onDelete = vi.fn(async () => undefined);
    render(<OvernightDetail card={card()} index={1} language="en" onSave={vi.fn(async () => undefined)} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
  });

  it("hides save and delete for ran cards", () => {
    render(<OvernightDetail
      card={card({ status: "ran", goal: "Finished purpose" })}
      index={0}
      language="en"
      onSave={vi.fn(async () => undefined)}
      onDelete={vi.fn(async () => undefined)}
    />);

    expect(screen.getByText("Finished purpose")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Finished purpose")).toBeDisabled();
  });
});
