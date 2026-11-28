import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { createOwnerHandoff } from "./handoff";
import { parseDeployment, parsePreparedSetup } from "./protocol";

const backend = fileURLToPath(
  new URL("../../packages/backend/", import.meta.url),
);

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      deployment: { type: "string" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "bun run setup:owner [--deployment deployment-name] [--no-open]\nUses the configured backend deployment. Never resets an existing owner.",
    );
    return;
  }
  const envFile = Bun.file(`${backend}.env.local`);
  const env = (await envFile.exists()) ? parseEnv(await envFile.text()) : {};
  const deployment = parseDeployment(
    values.deployment ?? process.env.CONVEX_DEPLOYMENT ?? env.CONVEX_DEPLOYMENT,
  );
  if (!deployment) {
    console.error(
      "Choose the backend first: pass --deployment deployment-name, or configure packages/backend/.env.local.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Preparing owner setup for Convex deployment ${deployment}.`);
  const token = crypto.getRandomValues(new Uint8Array(32)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
  const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
  const child = Bun.spawn(
    [
      process.execPath,
      "node_modules/convex/bin/main.js",
      "run",
      "ownerSetup:prepare",
      JSON.stringify({ hash, expiresAt: Date.now() + 10 * 60_000 }),
      ...(values.deployment ? ["--deployment", deployment] : []),
    ],
    { cwd: backend, stdout: "pipe", stderr: "pipe", stdin: "inherit" },
  );
  const [stdout] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0) {
    console.error(
      "Couldn't prepare owner setup. Check your Convex login and that this deployment runs the matching owner-setup backend.",
    );
    process.exitCode = 1;
    return;
  }
  const prepared = parsePreparedSetup(JSON.parse(stdout));
  if (!prepared.ok || !prepared.url) {
    console.error(prepared.message);
    process.exitCode = 1;
    return;
  }
  const destination = new URL(prepared.url);
  if (prepared.kind === "unclaimed") destination.hash = `setup=${token}`;
  console.log(
    prepared.kind === "claimed"
      ? "This reader already has an owner. Sign in to continue setup; the account is unchanged."
      : "Create your owner account in the browser. This one-use setup link expires in ten minutes.",
  );
  const handoff = createOwnerHandoff(destination);
  try {
    if (values["no-open"]) {
      console.log(
        `Open this local handoff on this machine: ${handoff.url.href}`,
      );
    } else {
      let command = ["xdg-open", handoff.url.href];
      if (process.platform === "darwin") command = ["open", handoff.url.href];
      if (process.platform === "win32")
        command = ["rundll32", "url.dll,FileProtocolHandler", handoff.url.href];
      const browser = Bun.spawn(command, {
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await browser.exited) !== 0)
        console.log(
          `Open this local handoff on this machine: ${handoff.url.href}`,
        );
    }
    if (!(await handoff.opened)) {
      console.error(
        "The browser handoff expired. Run bun run setup:owner again.",
      );
      process.exitCode = 1;
    }
  } finally {
    await handoff.close();
  }
}

await main().catch(() => {
  console.error(
    "Owner setup couldn't finish. Check the command arguments and connection, then try again.",
  );
  process.exitCode = 1;
});
