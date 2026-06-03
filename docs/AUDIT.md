# Gardenaz Agent Audit

Last updated: 2026-06-03

## Scope

Repo: `/root/projects/Gardenaz/agent`

Purpose: Runtime AI agent for Gardenaz. It translates beginner intent into a safe strategy, ranks USDY/mETH opportunities, enforces deterministic policy, exposes HTTP/MCP tools, can quote/execute Odos routes, and can anchor decisions on-chain.

## Current Status

Working:

- `src/garden-agent.ts` implements beginner garden planning.
- `POST /garden/plan` exists.
- MCP tool `plan_garden_agent` exists.
- `POST /autopilot/plan` exists.
- Odos execution adapter exists.
- DecisionLog relayer exists.
- Tests pass: 18/18.
- Typecheck passes.

Not production-ready:

- Garden execute path is not wired.
- MCP `log_decision` is listed but not handled.
- Input validation is thin.
- Network/deployment defaults are confusing.
- Package exports TS source instead of built JS.

## Findings

### P0: Garden execute semantics incomplete

- Files:
  - `src/garden-agent.ts`
  - `src/server.ts`
- `GardenRequest.execute` exists, but `/garden/plan` only returns plan/simulation.
- Gap: UI/user may think “execute” plants funds, but agent only plans.

Fix options:

1. Wire `execute=true` to guarded `executeRealRoute()` after:
   - decision policy approved,
   - action is rebalance,
   - market guard allows,
   - user approval present,
   - amount/notional cap valid.
2. Or explicitly reject `execute=true` with clear error until execution is ready.

### P0: MCP listed tool not implemented

- File: `src/server.ts`
- `log_decision` appears in `/mcp/tools/list` but no handler exists in `/mcp/tools/call`.

Fix:

- Implement handler using `anchorDecision()` or remove from list.

### P0: Deployment defaults mismatch current testnet

- File: `src/config/contracts.ts`
- Defaults: chainId `5000`, network `mantle`.
- Current deployment JSON: Mantle Sepolia chainId `5003`.

Fix:

- Make default mode explicit.
- Use Sepolia JSON for proof/identity testing.
- Use Mantle mainnet only for real Odos execution when configured.

### P1: Input validation thin

- File: `src/server.ts`
- `readJson()` parses raw body.
- `buildIntent()` casts `riskPreference` as `RiskLevel` without validating 1|2|3.
- `user` not address-validated.
- `amount` is string and later may be parsed with precision risk.

Fix:

- Add schema validation for HTTP and MCP args:
  - EVM address format.
  - positive decimal string.
  - risk in 1|2|3.
  - bounded slippage.
  - non-empty message.

### P1: Package export points to TS source

- File: `package.json`
- Exports map to `./src/*.ts`.
- Works in local TS/tsx environments but can break for package consumers.

Fix:

- Export `dist/*.js` and `dist/*.d.ts` after build.
- Add `types` fields.

### P1: Real notional cap incomplete

- Files:
  - `src/execution/index.ts`
  - `src/execution/odos.ts`
- Execution cap uses configured maximum, but does not compute actual USD notional from token decimals/price.

Fix:

- Validate request notional using token decimals and price source.
- Reject above cap before Odos transaction assembly.

### P1: Odos response key casing risk

- File: `src/execution/odos.ts`
- Quote maps may use lowercase token address keys.
- Current indexing may fail if casing differs.

Fix:

- Normalize quote map keys to lowercase before lookup.

### P1: LLM advisor role unclear

- File: `src/autopilot.ts`
- Advisor signal is generated/sanitized, but deterministic ranked opportunity still drives selection.
- In garden tests, only `mockAdvisor` can override selected opportunity.

Fix:

- Decide product rule:
  - advisory only: rename copy/fields to avoid implying LLM controls strategy.
  - advisory ranking: add post-advisor candidate selection, then deterministic policy gate.

### P1: Weather guard can conflict with policy

- File: `src/garden-agent.ts`
- Rainy market overrides action to hold, but policy may still say approved.

Fix:

- Add explicit `marketGuard` or `executionAllowed` flag in garden response.
- UI should treat execution as allowed only when policy and market guard both allow.

### P2: README stale

- README references `src/llm.ts`, but file is absent.
- README MCP list misses `plan_garden_agent`.
- README says some future items that are now partially implemented.

Fix:

- Update README to match current server, garden agent, Odos, relayer status.

## Verification Snapshot

- `pnpm test` passes: 18 tests.
- `pnpm typecheck` passes.
- Repo clean after latest push at audit time.

## Next Agent Work Order

1. Fix `log_decision` MCP mismatch.
2. Add request validation.
3. Resolve Sepolia/mainnet config defaults.
4. Define and implement/reject garden `execute=true`.
5. Fix package exports.
6. Improve execution safety cap and Odos key normalization.
7. Update README.
