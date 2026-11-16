# PriceScout

**A local-first product that turns retailer checks into a useful price history—and exposes the same capabilities to AI clients through MCP.**

PriceScout is a hands-on product and engineering experiment in retail data, trustworthy AI, and practical agent integration. It combines a React dashboard, TypeScript services, SQLite persistence, retailer adapters, scheduled monitoring, and a standalone Model Context Protocol (MCP) server. The AI client chooses a tool; PriceScout validates the request and returns saved data or runs an explicitly requested scan. No LLM is embedded in the MCP server.

> The cheeky product discovery: while building and using PriceScout, I spotted an Amazon price drop by accident—and ordered an iPhone 17e. The best product demo is sometimes the one that changes your own buying decision.

## What it does

- Monitors configured phone models and variants across supported UK retailers.
- Stores verified GBP offers, timestamps, product links, scan runs, and detected price reductions in SQLite.
- Shows current search results and historical observations in a local web interface.
- Runs scheduled scans daily at 18:00 Europe/London while the machine and backend are running, as well as manual scans.
- Offers an optional ad hoc natural-language search flow using a local Ollama model. The model proposes structured intent; Zod validation, the product catalogue, fixed query functions, and existing retailer adapters constrain execution. It does not generate prices or SQL.
- Exposes price history, price drops, retailer comparisons, and live scans as four MCP tools for compatible AI clients.

PriceScout favors traceable observations over fabricated certainty: historical results carry observation timestamps, comparisons use the same configured variant, and unavailable retailers or failed requests are reported. Retail coverage depends on retailer access and can change.

## Architecture

```text
React + Vite UI ──> Express / TypeScript services ──> SQLite
                         ▲                         ▲
                         │                         │
MCP client ──stdio──> MCP adapter ─────────────────┘
                         │
                         └── existing scanner adapters (live scan tool only)
```

The MCP adapter is a separate stdio process (`backend/src/mcp.ts`) built with the official TypeScript MCP SDK and Zod schemas. It reuses PriceScout's product catalogue, scanner services, adapters, and database. It can run without the web UI or Vite server. Standard output is reserved for MCP protocol traffic; startup errors go to standard error. The first three tools read saved records; `search_prices` contacts configured retailer adapters and persists verified outcomes.

## Run locally

Requirements: Node.js LTS and npm. From this project directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000`. On Windows, `start-pricescout.cmd` starts the app and `stop-pricescout.cmd` stops its local listeners. The frontend and backend bind to loopback. Keep the backend running for scheduled scans; Windows Task Scheduler is not configured, and the machine must be awake at the scheduled time.

The database is `data/pricescout.db` and is excluded from Git. It contains local product settings, scan runs, observations, price changes, and ad hoc search history. Back it up with the app stopped.

## Retailer and AI behavior

PriceScout uses retailer-specific adapters rather than a generic scraping engine. The catalogue and adapter coverage are maintained in the code; retailer blocking and support may change. CAPTCHA, authentication, and anti-bot protections are not bypassed. Offers are checked for model/variant, GBP price, and direct HTTPS product URL before storage.

The optional ad hoc assistant uses an already-installed local Ollama model (default `llama3.2:3b`). It does not download a model. Prompts go to the local Ollama service, not to the MCP server. Parsed intent is validated before a fixed PriceScout function runs; summaries and arithmetic are deterministic TypeScript output. Normal scanning and scheduled scans do not depend on Ollama.

## MCP: connect an AI client

MCP (Model Context Protocol) is a standard interface through which an AI application can discover and call tools exposed by a server. Here, the client supplies the reasoning and user interaction; PriceScout supplies bounded tools backed by its own records and services.

### Tools

| Tool | What it does | Side effects |
|---|---|---|
| `get_price_history` | Reads saved observations for a supported model, storage, period, and optional retailer. | Read-only |
| `get_price_drops` | Reads saved, verified price reductions calculated by PriceScout. | Read-only |
| `compare_retailers` | Compares each retailer's latest saved GBP offer for the same model, storage, condition, and unlocked status. Includes observation times. | Read-only |
| `search_prices` | Runs existing retailer adapters for a requested variant and returns offers and failures. | Makes retailer requests and writes scan/observation records |

Inputs are validated; model and storage must match the supported catalogue. No arbitrary SQL, shell, filesystem, credentials, or public HTTP endpoint is exposed. MCP runs locally over stdio: the MCP client starts and supervises the process, so you normally do not launch it manually.

### Run the MCP server

From a terminal in the PriceScout project directory, install dependencies once and start the stdio server:

```powershell
npm.cmd install
npm.cmd run mcp
```

The process waits for an MCP client to speak JSON-RPC over its standard input/output. It is expected to look idle in a terminal; do not type ordinary commands into that same terminal. Press `Ctrl+C` to stop it. The Windows shortcut `start-pricescout-mcp.cmd` runs the same command. For normal use, configure a client (example below) and let that client start the process on demand; do not start a second copy manually. The MCP process is independent of the web UI and Vite, but uses the same local SQLite database and existing backend services.

### Codex setup

Install dependencies in the project first. Add this to `~/.codex/config.toml`, replacing the example directory with your local checkout path:

```toml
[mcp_servers.pricescout]
command = "npm.cmd"
args = ["run", "mcp"]
cwd = "C:\\path\\to\\PriceScout"
```

Fully close and reopen the Codex client after changing configuration. Then ask a question such as “Use PriceScout to get price history for iPhone 17e.” Codex may ask permission before a tool call. `get_price_history`, `get_price_drops`, and `compare_retailers` read saved data; approve `search_prices` only when you want a live retailer scan and database write.

Other MCP clients can use the same stdio command, arguments, and working directory. For MCP Inspector, launch `npx.cmd @modelcontextprotocol/inspector`, configure a stdio server with command `npm.cmd`, arguments `run` and `mcp`, and the project directory as cwd. Inspector lets you discover tools, submit JSON inputs, and examine results.

## MCP examples: JSON-RPC requests and tool results

These are **illustrative payloads** showing the MCP protocol shape, not captured outputs. Actual records, timestamps, and retailer availability depend on the local database and scan results. MCP clients generally handle the JSON-RPC `initialize` and `tools/list` exchange; users or agents invoke a tool with `tools/call`.

### 1. Read price history

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_price_history",
    "arguments": {
      "model": "iPhone 17e",
      "storage": 256,
      "days": 7
    }
  }
}
```

Illustrative result (trimmed):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"data\":{\"model\":\"iPhone 17e\",\"storage\":256,\"observations\":[{\"retailer\":\"Amazon UK\",\"price_gbp\":699,\"verified_at\":\"2026-11-12T10:00:00.000Z\",\"product_url\":\"https://www.amazon.co.uk/example\"}],\"count\":1}}"
    }],
    "structuredContent": {
      "data": {
        "model": "iPhone 17e",
        "storage": 256,
        "observations": [{
          "retailer": "Amazon UK",
          "price_gbp": 699,
          "verified_at": "2026-11-12T10:00:00.000Z",
          "product_url": "https://www.amazon.co.uk/example"
        }],
        "count": 1
      }
    }
  }
}
```

### 2. Compare latest saved retailer offers

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "compare_retailers",
    "arguments": {
      "model": "iPhone 17e",
      "storage": 256,
      "condition": "New",
      "unlocked": true
    }
  }
}
```

Illustrative result (trimmed):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "structuredContent": {
      "data": {
        "offers": [
          { "retailer": "Amazon UK", "base_price": 689, "delivery": 0, "total_price": 689, "stock": "in_stock", "verified_at": "2026-11-12T10:00:00.000Z", "product_url": "https://www.amazon.co.uk/example" },
          { "retailer": "Apple UK", "base_price": 699, "delivery": 0, "total_price": 699, "stock": "in_stock", "verified_at": "2026-11-12T09:55:00.000Z", "product_url": "https://www.apple.com/uk/example" }
        ],
        "lowest": { "retailer": "Amazon UK", "total_price": 689 },
        "count": 2
      }
    }
  }
}
```

### 3. Request a live scan

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_prices",
    "arguments": {
      "model": "iPhone 17e",
      "storage": 256,
      "maxPrice": 700,
      "condition": "New",
      "unlocked": true
    }
  }
}
```

This contacts configured adapters and writes scan results. Failures are returned alongside successful offers; a failed retailer is not represented by an invented price.

## Development

```powershell
npm.cmd run mcp       # standalone stdio MCP server
npm.cmd run build     # Vite production build + backend TypeScript check
npm.cmd test          # Vitest suite
npm.cmd run dev       # backend + frontend
```

Tests use synthetic fixtures and do not perform live retailer scans. The MCP server can also be started directly with `start-pricescout-mcp.cmd` for local troubleshooting, though MCP clients normally manage its lifecycle.

## Product leadership lens

PriceScout is a small but end-to-end product: it frames a customer problem, translates retailer data into a decision surface, makes data freshness visible, constrains AI behavior, and closes the loop with a real purchase outcome. The implementation spans product choices and hands-on execution—from data model and service boundaries to tool schemas, client configuration, and user-facing caveats. The aim is useful automation that earns trust through provenance, explicit side effects, and honest failure states.

## Limitations and next steps

- Price history is only as complete as the observations PriceScout has saved; comparisons show saved observation times, not guaranteed live quotes.
- Retailer sites may change or block automated requests; unsupported sites and failures remain visible.
- Scheduled scans require the local backend process and an awake machine. Task Scheduler integration is not configured.
- Potential next steps include stronger MCP integration tests, user-configurable retailer coverage, scan freshness indicators, and opt-in alerts when verified changes meet a user's threshold.
