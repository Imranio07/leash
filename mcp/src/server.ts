// MCP server: lets any MCP-capable agent (Claude Desktop, Claude Code, Cursor, …) pay for APIs
// through a Leash vault. The vault's rules are enforced on-chain; this server only signs
// `agent_pay` with the agent key, exactly like the Leash CLI agent.
//
//   npm run mcp        (stdio transport)
//
// Uses AGENT_KEYPAIR, LEASH_VAULT and SERVICES_URL from the repo's .env.
// Tools: pay_for_api(service, params), list_services(), get_budget().

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// stdout carries the MCP protocol, so everything the shared tools print goes to stderr.
console.log = (...args: unknown[]) => console.error(...args);

const { callPaidService, createContext, getBudget, listServices } = await import("../../agent/src/tools");

const server = new McpServer({ name: "leash", version: "0.1.0" });

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) }],
});

function failure(e: unknown) {
  return { ...asText({ ok: false, error: e instanceof Error ? e.message : String(e) }), isError: true };
}

server.registerTool(
  "pay_for_api",
  {
    title: "Pay for an API call through a Leash vault",
    description:
      "Calls a paid API. If it answers HTTP 402, pays the price from the Leash vault with agent_pay, retries with " +
      "the transaction signature and returns the data. The Solana program enforces the owner's rules (per-payment max, " +
      "daily cap, recipient allowlist, expiry, revoke); a rejected payment returns the program error name and an " +
      "explorer link. Services: weather {city}, translate {text, to}, news {topic}.",
    inputSchema: {
      service: z.string().describe("Service id from list_services, e.g. weather"),
      params: z.record(z.string(), z.string()).default({}).describe('Service parameters, e.g. {"city": "Bishkek"}'),
    },
  },
  async ({ service, params }) => {
    try {
      const ctx = await createContext(`mcp pay_for_api ${service} ${JSON.stringify(params)}`);
      return asText(await callPaidService(ctx, service, params, `${service} service (mcp)`));
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "list_services",
  { title: "List paid APIs", description: "Paid APIs available to the agent, with parameters and prices." },
  async () => {
    try {
      return asText(await listServices(await createContext("mcp list_services")));
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "get_budget",
  {
    title: "Leash vault budget",
    description: "Vault balance, spent today, daily cap, per-payment max, allowlisted recipients, expiry, revoked flag.",
  },
  async () => {
    try {
      return asText(await getBudget(await createContext("mcp get_budget")));
    } catch (e) {
      return failure(e);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error("Leash MCP server ready (stdio): pay_for_api, list_services, get_budget");
