# Gardenaz Agent Context

Read this before modifying the agent.

## Product Role

The agent is the runtime intelligence layer for Gardenaz. It maps beginner natural language intent into safe USDY/mETH strategies, ranks opportunities, enforces deterministic policy, returns garden/game state, and eventually handles guarded real execution and on-chain proof.

## Key Invariants

- AI/LLM must never raise risk above user preference.
- Policy gate is deterministic and must win over LLM suggestions.
- Beginner UX output must be simple: crop, weather, safe explanation, action.
- Planning and execution must stay separate until explicit user approval.

## Key Files

- `src/garden-agent.ts` — beginner garden wrapper around autopilot.
- `src/autopilot.ts` — opportunity ranking + deterministic policy decision.
- `src/server.ts` — HTTP service and MCP-like endpoints.
- `src/execution/odos.ts` — Odos quote/assemble path.
- `src/execution/index.ts` — execution adapter and env gates.
- `src/relayer.ts` — DecisionLog/approval relayer helpers.
- `src/config/contracts.ts` — contract deployment/env loader.
- `src/config/mantle-sepolia.json` — current copied deployment JSON.
- `docs/AUDIT.md` — latest agent audit.

## Current Endpoints

- `GET /health`
- `POST /autopilot/plan`
- `POST /garden/plan`
- `GET /mcp/tools/list`
- `POST /mcp/tools/call`

MCP-like tools:

- `plan_autopilot_strategy`
- `plan_garden_agent`
- `quote_rwa_route`
- `execute_rwa_route`
- `log_decision` is listed but not implemented yet.

## Known Gaps

- `/garden/plan` plans only; `execute` flag not wired.
- Input validation thin.
- `log_decision` MCP mismatch.
- Default deployment config uses Mantle mainnet but current proof contracts are Sepolia.
- Package exports TS source instead of dist output.
- Notional cap for Odos execution needs real USD valuation.

## Do Next

1. Add validation for all request surfaces.
2. Fix `log_decision` handler or list.
3. Resolve network config defaults.
4. Define garden execute behavior.
5. Harden execution adapter.
6. Update README.
