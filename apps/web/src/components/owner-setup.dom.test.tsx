// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type FirstLibraryChoice,
  OwnerLibraryStep,
} from "./owner-library-step";
import {
  OwnerSecurityStep,
  type PasskeyEnrollment,
} from "./owner-security-step";
import { UnclaimedReader } from "./unclaimed-reader";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

it("lets an owner defer a passkey without starting device enrollment", async () => {
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <OwnerSecurityStep
        enroll={async () => {
          calls.push("enroll");
          return { ok: true };
        }}
        onContinue={async () => {
          calls.push("continue");
        }}
      />,
    );
  });
  await act(async () => button("Not now, continue with my password").click());
  expect(calls).toEqual(["continue"]);
  expect(document.body.textContent).toContain("no email password reset");
});

it("keeps a cancelled passkey step open with a working password fallback", async () => {
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <OwnerSecurityStep
        enroll={async () => ({
          ok: false,
          message: "Device prompt cancelled.",
        })}
        onContinue={async () => {
          calls.push("continue");
        }}
      />,
    );
  });
  await act(async () => button("Add a passkey").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Device prompt cancelled.",
  );
  expect(calls).toEqual([]);
  expect(button("Not now, continue with my password").disabled).toBe(false);
});

it("does not start two device prompts from a double click", async () => {
  const pending = Promise.withResolvers<PasskeyEnrollment>();
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <OwnerSecurityStep
        enroll={() => {
          calls.push("enroll");
          return pending.promise;
        }}
        onContinue={async () => {
          calls.push("continue");
        }}
      />,
    );
  });
  await act(async () => {
    const control = button("Add a passkey");
    control.click();
    control.click();
  });
  expect(calls).toEqual(["enroll"]);
  await act(async () => pending.resolve({ ok: true }));
  expect(calls).toEqual(["enroll", "continue"]);
});

it("retries saving progress without creating a second passkey", async () => {
  let enrollments = 0;
  let advances = 0;
  await act(async () => {
    root.render(
      <OwnerSecurityStep
        enroll={async () => {
          enrollments++;
          return { ok: true };
        }}
        onContinue={async () => {
          advances++;
          if (advances === 1) throw new Error("Fixture connection failure");
        }}
      />,
    );
  });
  await act(async () => button("Add a passkey").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "try again",
  );
  await act(async () => button("Continue").click());
  expect(enrollments).toBe(1);
  expect(advances).toBe(2);
});

it.each<{ label: string; choice: FirstLibraryChoice }>([
  { label: "Import from Readwise Reader", choice: "readwise" },
  { label: "Add an article or book", choice: "article" },
  { label: "Start empty", choice: "empty" },
])("finishes with the explicit library choice: $choice", async ({
  label,
  choice,
}) => {
  const choices: FirstLibraryChoice[] = [];
  await act(async () => {
    root.render(
      <OwnerLibraryStep
        onChoose={async (value) => {
          choices.push(value);
        }}
      />,
    );
  });
  expect(choices).toEqual([]);
  expect(document.body.textContent).toContain(
    "You can read without setting up AI",
  );
  await act(async () => button(label).click());
  expect(choices).toEqual([choice]);
});

it("keeps a failed library step retryable", async () => {
  let attempts = 0;
  await act(async () => {
    root.render(
      <OwnerLibraryStep
        onChoose={async () => {
          attempts++;
          if (attempts === 1) throw new Error("Fixture connection failure");
        }}
      />,
    );
  });
  await act(async () => button("Start empty").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "progress is saved",
  );
  expect(button("Start empty").disabled).toBe(false);
  await act(async () => button("Start empty").click());
  expect(attempts).toBe(2);
});

it("explains owner setup without offering public registration or an access request", async () => {
  await act(async () => root.render(<UnclaimedReader />));
  expect(document.body.textContent).toContain("bun run setup:owner");
  expect(document.body.textContent).toContain(
    "Visiting this page can’t make someone the owner",
  );
  expect(document.querySelector("form")).toBeNull();
  expect(document.querySelector("button")).toBeNull();
});
