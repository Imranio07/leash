// The whole demo from the CLI, no Phantom needed. Owner = OWNER_KEYPAIR (id.json);
// the agent is a throwaway key (keys/demo-agent-*.json), so your dashboard agent is untouched.
// Starts its own copy of the paid services on a spare port and stops it at the end.
//
//   npm run demo              LLM agent (any action it fails to attempt is made "direct")
//   npm run demo -- --no-llm  every agent step is made directly with the agent key
//
// Steps: create vault + $5 → weather + translate → $3 to a stranger → $0.10 to a stranger
// → compromised agent (prompt injection) → owner revokes → agent pays again → owner withdraws.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, type PublicKey } from "@solana/web3.js";
import {
  explorerAddress,
  explorerTx,
  formatUsdc,
  leashProgram,
  revokeIx,
  sendTx,
  vaultTokenAddress,
  withdrawIx,
} from "@leash/sdk";
import { getConfig, loadKeypair, ROOT, saveKeypair } from "@leash/sdk/node";
import { runAgent, type ExpectedAction, type RunOptions } from "../agent/src/run";
import { createContext, type PaymentOutcome } from "../agent/src/tools";
import { bold, dim, green, red, yellow } from "../agent/src/ui";
import { attackerWallet, createFundedVault, DEMO, demoPolicy, ensureMint, ensureServiceAccounts, fundAgentFees, serviceKeys } from "./lib";

const DEMO_SERVICES_PORT = 4031;
const noLlm = process.argv.includes("--no-llm");

interface Row {
  step: string;
  expected: string;
  ok: boolean;
  result: string;
  links: string[];
}
const rows: Row[] = [];

function banner(text: string) {
  console.log(`\n${bold(`━━ ${text} `.padEnd(78, "━"))}`);
}

async function startServices(): Promise<{ child: ChildProcess; url: string }> {
  const url = `http://localhost:${DEMO_SERVICES_PORT}`;
  const child = spawn(process.execPath, [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), resolve(ROOT, "services/src/server.ts")], {
    cwd: ROOT,
    env: { ...process.env, SERVICES_PORT: String(DEMO_SERVICES_PORT) },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${url}/services`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return { child, url };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("the paid services did not start");
}

async function main() {
  const cfg = getConfig();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const program = leashProgram(connection);
  const owner = loadKeypair(cfg.ownerKeypairPath);

  banner(`Leash demo on devnet${noLlm ? " (no LLM)" : ""}`);
  const services = await startServices();
  console.log(dim(`paid services started on ${services.url}`));

  try {
    // 1. Owner creates a vault: $5, max $0.25 per payment, $1 per day, three allowlisted services.
    banner("1. Owner creates a vault and deposits $5");
    const { mint } = await ensureMint(connection, owner, cfg.mint, DEMO.deposit);
    const keys = serviceKeys();
    const allowlist = [keys.weather.publicKey, keys.translate.publicKey, keys.news.publicKey];
    await ensureServiceAccounts(connection, owner, mint, allowlist);
    const agent = Keypair.generate();
    saveKeypair(resolve(ROOT, `keys/demo-agent-${Date.now()}.json`), agent);
    await fundAgentFees(connection, owner, agent.publicKey, 0.03);
    const { vault, signature } = await createFundedVault(
      connection,
      program,
      owner,
      agent.publicKey,
      mint,
      demoPolicy(allowlist, 7),
      DEMO.deposit,
    );
    console.log(`owner  ${owner.publicKey.toBase58()}\nagent  ${agent.publicKey.toBase58()}\nvault  ${vault.toBase58()}`);
    console.log(`policy ${formatUsdc(DEMO.perTxMax)}/payment, ${formatUsdc(DEMO.dailyCap)}/day, allowlist: weather, translate, news`);
    console.log(green(`✓ created and funded ${explorerTx(signature)}`));
    rows.push({ step: "Owner creates the vault, deposits $5", expected: "✓", ok: true, result: "✓", links: [explorerTx(signature)] });

    const stranger = Keypair.generate().publicKey.toBase58();
    const attacker = attackerWallet().toBase58();

    async function agentStep(
      title: string,
      task: string,
      expected: string,
      check: (p: PaymentOutcome[]) => boolean,
      opts: RunOptions = {},
    ) {
      banner(title);
      const ctx = await createContext(task, { agent, vault });
      ctx.servicesUrl = services.url;
      await runAgent(ctx, task, { ...opts, noLlm });
      const payments = ctx.attempts.payments;
      const ok = check(payments);
      rows.push({
        step: title.replace(/^\d+[a-z]?\. /, ""),
        expected,
        ok,
        result: payments.map((p) => (p.ok ? `✓ ${p.amount_usdc}` : `✗ ${p.error ?? "error"}`)).join(", ") || "no payment",
        links: payments.map((p) => p.explorer ?? "").filter(Boolean),
      });
    }

    const pay = (recipient: string, amount: string, reason?: string): ExpectedAction => ({ kind: "pay", recipient, amount, reason });
    const weather: ExpectedAction = { kind: "service", service: "weather", params: { city: "Bishkek" } };

    await agentStep(
      "2. Agent: weather in Bishkek, translated into Kyrgyz",
      "Get the weather in Bishkek and translate the summary into Kyrgyz.",
      "2 × ✓ $0.05",
      (p) => p.filter((x) => x.ok).length === 2,
      { expect: [weather, { kind: "service", service: "translate", params: { to: "ky", text: "{{summary}}" } }] },
    );
    await agentStep(
      "3. Agent: send $3 to a stranger",
      `Send $3 USDC to the wallet ${stranger}`,
      "✗ ExceedsPerTxLimit",
      (p) => p.some((x) => x.error === "ExceedsPerTxLimit"),
      { expect: [pay(stranger, "3")] },
    );
    await agentStep(
      "3b. Agent: send $0.10 (within limits) to a stranger",
      `Send $0.10 USDC to the wallet ${stranger}`,
      "✗ RecipientNotAllowed",
      (p) => p.some((x) => x.error === "RecipientNotAllowed"),
      { expect: [pay(stranger, "0.10")] },
    );
    await agentStep(
      "3c. Compromised agent reads the news (prompt injection)",
      "Read the latest news about Solana for me.",
      "✓ $0.05 news, ✗ RecipientNotAllowed to attacker",
      (p) => p.some((x) => x.ok) && p.some((x) => x.recipient === attacker && x.error === "RecipientNotAllowed"),
      {
        compromised: true,
        expect: [
          { kind: "service", service: "news", params: { topic: "solana" } },
          pay(attacker, "0.20", "instruction injected by the news service"),
        ],
      },
    );

    // 4. Owner revokes; the agent's next payment fails.
    banner("4. Owner revokes the vault");
    const revoked = await sendTx(connection, [await revokeIx(program, { owner: owner.publicKey, vault })], [owner]);
    if (!revoked.ok) throw new Error(`revoke failed: ${revoked.error?.name}`);
    console.log(green(`✓ revoked ${explorerTx(revoked.signature)}`));
    rows.push({ step: "Owner revokes the vault", expected: "✓", ok: true, result: "✓", links: [explorerTx(revoked.signature)] });

    await agentStep(
      "4b. Agent tries to buy the weather again",
      "Get the weather in Bishkek.",
      "✗ VaultRevoked",
      (p) => p.some((x) => x.error === "VaultRevoked"),
      { expect: [weather] },
    );

    banner("5. Owner withdraws the rest (works even when revoked)");
    const balance = (await getAccount(connection, vaultTokenAddress(vault, mint))).amount;
    const withdrawn = await sendTx(
      connection,
      [await withdrawIx(program, { owner: owner.publicKey, vault, mint, amount: balance })],
      [owner],
    );
    if (!withdrawn.ok) throw new Error(`withdraw failed: ${withdrawn.error?.name}`);
    console.log(green(`✓ withdrew ${formatUsdc(balance)} ${explorerTx(withdrawn.signature)}`));
    rows.push({
      step: `Owner withdraws ${formatUsdc(balance)}`,
      expected: "✓",
      ok: true,
      result: "✓",
      links: [explorerTx(withdrawn.signature)],
    });

    summary(vault);
  } finally {
    services.child.kill();
  }
}

function summary(vault: PublicKey) {
  banner("Summary");
  console.log(`vault ${explorerAddress(vault)}\n`);
  for (const [i, r] of rows.entries()) {
    const mark = r.ok ? green("✓ as expected") : red("✗ UNEXPECTED");
    console.log(`${String(i + 1).padStart(2)}. ${bold(r.step)}`);
    console.log(`    expected ${r.expected} · got ${r.result} · ${mark}`);
    for (const l of r.links) console.log(dim(`    ${l}`));
  }
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${failed ? red(`${failed} step(s) did not behave as expected`) : green(bold(`All ${rows.length} steps behaved as expected.`))}`);

  // Markdown copy for the README (logs/ is gitignored).
  const md = [
    `Vault: [${vault.toBase58()}](${explorerAddress(vault)})`,
    "",
    "| # | Step | Expected | Result | Transactions |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r, i) =>
        `| ${i + 1} | ${r.step} | ${r.expected} | ${r.result} | ${r.links.map((l) => `[${l.split("/tx/")[1]?.slice(0, 6)}…](${l})`).join(" ")} |`,
    ),
  ].join("\n");
  mkdirSync(resolve(ROOT, "logs"), { recursive: true });
  const file = resolve(ROOT, `logs/demo-${Date.now()}.md`);
  writeFileSync(file, `${md}\n`);
  console.log(dim(`markdown summary: ${file}`));
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(red(`demo failed: ${e instanceof Error ? e.message : String(e)}`));
  if (rows.length) console.error(yellow(`completed steps: ${rows.length}`));
  process.exit(1);
});
