# CLAUDE.md

Account-area frontend template: React 19 + TypeScript + Vite, MUI, react-router, react-query,
zustand, i18next.

**Write code comments and user-facing strings in Russian** — that is the language of this
repository. Identifiers, `Error.message` values thrown by `@core/*`, and this file are English.

## Commands

| Command                           | What it does                                                     |
| --------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server; MSW mocks come up by default in dev             |
| `npm run build`                   | `tsc --noEmit` + `vite build` (typecheck is part of the build)   |
| `npm run typecheck`               | `tsc --noEmit` only                                              |
| `npm run lint`                    | ESLint over the repo (flat config)                               |
| `npm test`                        | `vitest run` — jsdom, setup `src/test/setup.ts`, network via MSW |
| `npm run format` / `format:check` | Prettier                                                         |

Run `npm run typecheck && npm run lint && npm test` before committing.

## Layer boundaries

Dependency direction is declared with `eslint-plugin-boundaries` in `eslint.config.js`, so the
linter enforces it rather than convention:

- `app` → `core`, `modules`, `ui`, `config`;
- `modules` → `core`, `ui`, `config` — **a module cannot see another module** (`@modules/other`
  from `src/modules/auth` is a lint error); shared code moves up into `core` or into a contract;
- `core` → `core`, `ui`, `config` — the kernel knows nothing about modules or app;
- `ui` → `ui`, `config`; `config` → `config`;
- `mocks` → `mocks`, `modules`, `core`, `config` (dev infrastructure).

Two more rules catch most mistakes:

- `import-x/no-internal-modules` — cross-package alias imports go through the barrel only:
  `@core/api`, never `@core/api/errors`. Relative imports inside a package are untouched.
- `import-x/no-cycle: error` — the usual source of a cycle here is not the code but a barrel that
  merges a consumer layer and its dependency into one node. Fix by **splitting the package** (that
  is how `@core/request-meta` came to be), not by relaxing the rule.

Aliases (`tsconfig.json` + `vite.config.ts`): `@app`, `@core/*`, `@ui`, `@modules/*`, `@config`,
`@mocks/*`.

## API contract

`contracts/auth/openapi.yaml` is an **external** contract — do not edit it. Close any mismatch on
the client and in the mocks; for the spec itself, write recommendations to the backend instead.

The spec is the source of truth: do not write defensive tests for "what if the backend answers
differently". Mock behaviour is not backend behaviour, so a mock can never be cited as the contract.

Limits on fields the user types by hand are mirrored in `src/config` (`limits`) and checked against
the spec by `constants.test.ts`.

## API error model

`normalizeError`, in the `authClient` response interceptor (`@core/api`), maps any failure to one
of four classes:

- `ApiFieldError` — 400 `application/json` with an `errors[]` list (plus optional
  `operation_state`);
- `ApiRateLimitError` — 429; retry delay in `retryAfterSec` (the `Retry-After` header is optional);
- `ApiProblemError` — RFC 9457 problem+json: 401/403/404/422/5xx;
- `ApiTransportError` — network/timeout/never reached the server.

A 400 `code` has two shapes: `ErrorCode` or `ErrorCode/field_name` (split on the **first** `/`; the
suffix matches the field name in the request JSON). Do not parse that by hand:

- forms use `ApiFieldError.split(fieldNames, t)` — what lands under fields, what becomes a form-wide
  message;
- everything else (page banners, hooks) uses `apiErrorText(e, t)` — the server detail, otherwise a
  translation;
- when you need the code prefix itself, use `parseErrorCode(code).reason`.

The classes' own `Error.message` values are English and diagnostic (the error is assembled in the
interceptor, which does not know the UI language) — they never reach the screen, only logs and
devtools.

## i18n

No user-facing strings in code: shared text lives in `src/core/i18n/i18n.ts` (`common.*`), module
text in `src/modules/*/i18n/{ru,en}.json`, registered via `addTranslations` when a module is
registered.

`interpolation.escapeValue: false` (standard for react-i18next), so translation safety rests
entirely on React escaping — `dangerouslySetInnerHTML` is banned by lint across `src`. The threat
model is spelled out in a comment in `eslint.config.js` and pinned by `src/test/eslintConfig.test.ts`;
change the rule only together with that test.

## Comments

Comments describe the present state only. No "it used to be X, now it is Y", no references to
deleted code, no "regression"/"now" framing — history lives in git. Refer to backend data sources
abstractly ("the server-side list"), without file paths or package names.

## Mocks

MSW, `src/mocks/handlers.ts`, operations and sessions held in memory. Started in `main.tsx` only
under `import.meta.env.DEV && config.enableMocks`, so they are stripped from production builds.

Every demo branch is reachable either through a reserved value (`taken@example.com`,
`inprogress@example.com`, `nobody@example.com`) or a `VITE_MOCK_*` env flag. **Always document a new
flag in `.env.example`** — what it turns on and why — otherwise the branch cannot be found by hand.

## Toolchain

- Keep TypeScript on **6.0.x**: `typescript-eslint` declares `<6.1.0`.
- Rebuilding `package-lock.json` takes **two** `npm install` runs, otherwise `npm ci` fails on
  `ajv`. Do not bring back `--legacy-peer-deps`.
- `@mui/codemod` output is canonical: never hand-revert its formatting.
