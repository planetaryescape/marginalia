import { describe, expect, it, vi } from "vitest";
import { createNoteAutosave } from "./note-autosave";

const draft = (plain: string) => ({ html: `<p>${plain}</p>`, plain });

describe("note autosave", () => {
  it("keeps a failed draft so closing can be blocked and retried", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const autosave = createNoteAutosave(save);
    autosave.change(draft("Keep this"));
    expect(await autosave.flush()).toBe(false);
    expect(autosave.hasPending()).toBe(true);
    expect(await autosave.flush()).toBe(true);
    expect(autosave.hasPending()).toBe(false);
    expect(save).toHaveBeenNthCalledWith(2, draft("Keep this"));
  });

  it("coalesces overlapping flushes without losing text typed during a save", async () => {
    let acknowledge: (value: boolean) => void = () => {};
    const first = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(true);
    const autosave = createNoteAutosave(save);
    autosave.change(draft("First"));
    const closing = autosave.flush();
    autosave.change(draft("Latest"));
    expect(autosave.flush()).toBe(closing);
    acknowledge(true);
    expect(await closing).toBe(true);
    expect(save.mock.calls).toEqual([[draft("First")], [draft("Latest")]]);
    expect(autosave.hasPending()).toBe(false);
  });

  it("does not create a save when the editor has never changed", async () => {
    const save = vi.fn();
    expect(await createNoteAutosave(save).flush()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
