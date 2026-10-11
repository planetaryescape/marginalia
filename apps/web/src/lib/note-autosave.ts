export interface NoteDraft {
  html: string;
  plain: string;
}

/** One in-flight save, with failed and newly typed text kept until acknowledged. */
export function createNoteAutosave(
  save: (draft: NoteDraft) => Promise<boolean>,
) {
  let pending: NoteDraft | null = null;
  let running: Promise<boolean> | null = null;

  async function drain() {
    while (pending) {
      const draft = pending;
      if (!(await save(draft))) return false;
      if (pending === draft) pending = null;
    }
    return true;
  }

  return {
    change(draft: NoteDraft) {
      pending = draft;
    },
    hasPending() {
      return pending !== null;
    },
    flush(): Promise<boolean> {
      if (!running)
        running = drain().finally(() => {
          running = null;
        });
      return running;
    },
  };
}
