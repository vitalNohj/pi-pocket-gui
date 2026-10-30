# Remote execution: runner, protocol, and tool findings

Read-only investigation. No repository files were edited. No tests, builds, or service actions were run.

## Source versions and boundaries
- `/home/nohj/pi-pocket/package.json:3`: Pi Pocket 0.26.0.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/package.json:3`: Durable 1.4.0.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-coding-agent/package.json:3`: coding-agent 1.4.0.
- `/home/nohj/pi-pocket-gui/package.json`: GUI 0.1.4, Electron 45.1.0, Node types 22.20.5.
- The installed source and package documentation are the primary sources. These findings describe this checkout, not an assumed upstream version.
- Other agents own browser features, workspace features, and extension resource loading. Those need environment-aware APIs, but this note does not estimate their complete implementations.

## A. Connection and authentication
- `/home/nohj/pi-pocket/src/server/main.ts:149`: `createServer` calls an HTTP request handler. There is no application WebSocket upgrade handler.
- `/home/nohj/pi-pocket/src/server/http.ts:25`: `createHandler(options)` constructs `Auth` and `createApi`, then routes HTTP requests. An HTTP route alone cannot accept a Node HTTP upgrade.
- `/home/nohj/pi-pocket/src/server/http/api.ts:125-138`: `createApi` requires a signed-in person and checks `X-Pocket: 1` on non-GET requests.
- `/home/nohj/pi-pocket/src/server/auth.ts:94-111`: `Auth.user` accepts `pocket_auth` or a general user bearer token. Do not give this general bearer token to a runner.
- Add an explicit `ws` dependency if that server implementation is selected. The lockfile has transitive `ws`, but the project does not declare it directly.
- Proposed pairing: a native, origin-checked GUI action uses the signed-in Electron session to POST for a short-lived, single-use pairing credential. Native consent selects allowed folders. The runner exchanges it for a revocable runner-only secret. Store only its hash on the server. Bind it to one person, runner, and server identity. Keep it out of URLs and ordinary page state.
- Authenticate the upgrade with the runner secret, not a browser cookie. Alternatively authenticate the first frame before accepting any operation. Apply a short unauthenticated timeout. Require TLS except explicit trusted local use. Do not follow a redirect to another origin with credentials.
- Protocol needs version/capabilities, request IDs, operation and arguments, deadline, response/error, sequenced stream chunks, byte offsets, cancel/ack, heartbeat, and reconnect reconciliation. Bound frame sizes, output retention, outstanding calls, and buffer sizes. Avoid reissuing an effectful operation with a new request ID after a lost response.
- Use one live connection lease per runner. Fence old connections. A new connection reports boot identity and its retained operations/jobs.
- Open policy: which people can pair runners, and who can run commands in a shared session attached to someone else's runner? Existing session visibility must not automatically grant computer execution rights.
- Open integration: test WS through the GUI's actual proxy, tunnel, and any fronting SSO. Electron browser cookies do not automatically transfer to a standalone Node WS client.

## B. Actual tool integration
- `/home/nohj/pi-pocket/src/server/app.ts:746`: `registry.install(CodingTools)`. The app does not call `createAgentSession()`.
- `/home/nohj/pi-pocket/src/server/app.ts:876-895`: `Harness.open(..., { env: ({ conversationId, cwd }) => this.#wrapped(...) })` supplies the environment.
- `/home/nohj/pi-pocket/src/server/app.ts:1352-1371`: `envFor`, `#wrapped`, and `#env` currently choose a cached `NodeExecutionEnv` by cwd alone.
- `/home/nohj/pi-pocket/src/server/hidden.ts:422-466`: `wrapEnv` injects command variables and redacts output. Preserve this wrapper around the remote environment. Sending these variables to the runner requires explicit policy; model API keys must not be sent.
- `/home/nohj/pi-pocket/src/server/app.ts:3701-3703`: close calls each local environment's `cleanup`. Remote foreground cleanup must not accidentally end persistent background jobs.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:541-566`: `EnvTarget` contains `conversationId`, `cwd`, and committed `read`. The environment factory can be asynchronous. It does not receive a tool/task ID. A durable, cross-restart operation key therefore needs a tool wrapper or durable job task; a random RPC correlation ID alone is not sufficient.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/env/index.d.ts`: `ExecutionEnv extends FileSystem, Shell`. Implement native path resolution, reads, writes, binary readers including `info/read/scanLines/close`, directory readers, file metadata, execution with argv or string, streaming, errors, temp/spill files, cleanup, and capabilities needed by consumers. `watch` is a required filesystem member; `listFiles` is optional.
- Equal `env.id` values mean the same file namespace, independent of cwd. Use stable per-runner IDs; cache by runner ID and cwd. Never reuse local `node:local` for a runner. This also keeps file mutation serialization correct.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/tools/index.js:15-25`: installed `CodingTools` contains only `read`, `write`, `edit`, `bash`. No Durable grep/find/ls are installed.
- Durable read uses a binary handle and bounded scans, not merely whole-file `readFile`. Durable write/edit use the environment's path and mutation operations. Durable bash uses `env.exec`, spill paths, output windows, and retained output.
- The coding-agent SDK exposes all 7 `*Operations` interfaces: Read(readFile/access/image MIME), Write(writeFile/mkdir), Edit(readFile/access/writeFile), Bash(exec with streamed Buffer output and abort), Find(exists/glob), Ls(exists/stat/readdir), Grep(isDirectory/readFile).
- Critical limit: `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/grep.js:54-112` always calls local `ensureTool("rg")` and `spawn(rgPath, args, ...)`. Its Operations interface cannot move the search itself. In contrast, `find.js:64-80` delegates to a supplied `glob`.
- Prefer Durable tools with a remote `ExecutionEnv`. Register new Durable grep/find/ls wrappers using runner search/list methods. Update `/home/nohj/pi-pocket/src/server/reload.ts:122` `BUILT_IN_TOOLS` to reserve their names. Alternatively extend upstream GrepOperations, but do not claim the present SDK adapter is sufficient.
- Do not use server `node:path` to interpret Windows paths. The SSH example's cwd string replacement is not a production namespace or Windows solution.

## C. Background tasks and shell commands
- `/home/nohj/pi-pocket/src/server/background.ts` has 1524 lines. `Background.start:1155`, `#spawn:1315`, `#watch:633`, `#recover:830`, `read:1367`, `stop:1430` directly use server processes/files. Changing the Harness env will not move them.
- The current process backend uses `/proc`, boot ID, PID start ticks, an environment marker, Unix process groups, bash, coreutils `split`, local segmented logs, and exit files. It starts detached and unrefs the child. `BackgroundDoc` stores PID, boot, offsets, status, and the replay key.
- `/home/nohj/pi-pocket/src/server/extensions/background.ts:80-182`: `replay: "safe"`; key is `${api.taskId}:${api.callId}`. Output pins byte ranges and memoizes its answer. Preserve these guarantees when the runner owns the process/log ledger.
- A remote backend needs durable job IDs, local bounded log segments, result receipts, boot/process identity, start/status/output/stop RPCs, and stop intent reconciliation. A start must be recorded on the runner before it can be acknowledged. A lost acknowledgment must not start a second job.
- Cross-platform process containment is a material task. Unix process groups alone are not a Windows Job Object implementation. Do not promise all escaped descendants stop without an OS-backed containment design.
- `/home/nohj/pi-pocket/src/server/shell.ts:85-112`: `!` and `!!` use a Durable background task but not `Background.#spawn` detached execution. The `started` memo makes a server restart record `interrupted`, not rerun the command.
- `/home/nohj/pi-pocket/src/server/shell.ts:143-187`: `Shell.#run` already uses `runtime.env` / `env.exec`, with a 600-second timeout and 30000 retained characters. Select the runner environment and preserve its non-replay behavior. Do not state that `!` survives a restart today.
- During laptop sleep, local processes normally suspend; the connection is offline, not proof that a job exited. Reconnect must reconcile status, boot ID, byte offsets, and pending stops. A runner restart/reboot can produce an unknown/lost state, never automatic execution again.
- Decide foreground disconnect leases and background persistence separately. Ordinary foreground work needs cancellation/deadline enforcement; persistent jobs must not die merely because the server restarts.

## D. Durability and offline behavior
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/harness/tool.js:99`: `const intent = { phase: "execute", arguments: final, replay: tool.replay ?? "unsafe" };` commits before execution.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/harness/tool.js:110`: recovery reruns only if stored replay and the current tool both say `safe`.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/harness/tool.js:119-122`: unsafe recovery reports `Tool ${call.name} was interrupted and may have partially run`, diagnostic code `interrupted`.
- All 4 installed Durable coding tools omit a safe replay declaration. This includes read. Keep this conservative behavior initially. The background tool is separately safe through its receipt scheme.
- A live connection loss can wait and reattach the same RPC to the same retained result. It must not transparently repeat write/edit/bash on uncertainty. Persistent receipts and parameter hashes protect against ID reuse.
- Proposed offline policy, not existing behavior: show `runner offline`, wait for the same runner, persist a configurable deadline (10 minutes is a product default proposal), allow Stop, then report offline or uncertain completion clearly. Never fall back to the server. Do not let repeated immediate failures consume model calls indefinitely.
- Before reconnecting, resolve pending cancel/stop intents. Offline Stop cannot honestly confirm the remote process ended. A local foreground lease can enforce eventual termination, including after wake from sleep.
- Pin the environment/cwd for an invocation. Forbid environment changes during an active run. A server restart can keep current unsafe interruption semantics; making foreground work transparently reattach across server restarts requires additional Durable-aware tool wrappers and idempotent remote results.
- Test lost ack after write/exec, output replay without duplication, server restart, runner restart, disk-full ledger/logs, revocation, offline Stop, native path edge cases, and real laptop suspend/resume.

## E. Session and runner records
- `/home/nohj/pi-pocket/src/server/docs.ts:29-61`: `SessionMeta.cwd` in `SessionsDoc` (`pocket.sessions`).
- `/home/nohj/pi-pocket/src/server/commands.ts:408-463`: `Commands.createSession` writes cwd into both the conversation `AgentDoc` and `SessionsDoc` metadata. It validates through server-local `workspace.checkDirectory`, calls local `#inPlace`, and can read local project model defaults.
- `/home/nohj/pi-pocket/src/server/commands.ts:1537-1630`: `Commands.configure` updates agent cwd, then session metadata in another commit. Environment plus cwd must change atomically, with a busy guard.
- `/home/nohj/pi-pocket/src/server/app.ts:2962`: `cwdOf` falls back from cached AgentDoc to SessionMeta to server defaultCwd. A runner selection must never silently follow this last fallback.
- Add an authoritative conversation environment document readable through `EnvTarget.read`, and environment identity in session list metadata. Legacy sessions mean the server. Add per-user runner registrations, hashed credentials/revocation, ownership, and a per-user default environment setting through supported ConfigStore APIs.
- `/home/nohj/pi-pocket/src/server/commands.ts:2267`: `#fork` and resend paths need environment inheritance.
- `/home/nohj/pi-pocket/src/server/linked-sessions.ts:662-753`: `LinkedSessions.#create` copies AgentDoc and creates SessionMeta; propagate the environment explicitly.
- `/home/nohj/pi-pocket/src/server/extensions/subagents.ts:1020-1035`: owned child conversations inherit agent settings but a new core environment document needs explicit inheritance or a safe owner-chain resolver.
- Namespace folder favorites, recent folders, project trust, git/memory/resource caches, and runner jobs by environment ID plus path. The same string can refer to unrelated files on 2 computers.
- Dependency on workspace/resource agents: project defaults, worktrees, AGENTS.md, skills, prompt templates, uploads, previews, and git must not operate on a server folder merely because its name equals a runner path.

## F. Picker dependency
- `/home/nohj/pi-pocket/web/sheets/folder.js:125`: `CwdSheet`. `load:155` requests `/api/fs`, `make:229` posts `/api/fs`, `use:241` calls configure or createSession. `places:411` has Home and Computer, both server paths today.
- `/home/nohj/pi-pocket/web/store.js:2175,2216`: configure and createSession payloads need environment IDs.
- `/home/nohj/pi-pocket/src/server/http/api.ts:565-628`: `/api/fs` GET performs local readdir/stat, parent path and home lookup; POST uses local `makeFolder`.
- Add Remote -> owned/authorized environment list -> runner folder listing. Keep selection, requests, error states, favorites, recents, and stale-response generation keyed by environment and path. Let the runner supply native roots/drives and breadcrumbs rather than assuming `/`.
- `/home/nohj/pi-pocket/web/style.css:7145-7540`: existing folder picker CSS. This is mainly the folder/UI agent's scope.

## G. Runner packaging and security
- `/home/nohj/pi-pocket-gui/src/main/desktop.ts:69-85`: `setUpDesktop` checks sender contents, top frame, and configured origin with `fromServerPage`. Reuse this policy for runner management only, not arbitrary filesystem IPC exposed to page JavaScript.
- `/home/nohj/pi-pocket-gui/src/preload/server.ts:40`: bridge capabilities currently lack a runner capability. Add narrow pairing/status/folder-grant controls and shared types; maintain version 1 capability negotiation.
- `/home/nohj/pi-pocket-gui/src/main/index.ts:331-341`: GUI quit exits the app. Embedding the runner in main couples its lifetime and failures to the GUI. It avoids a separate runtime and is the simplest packaging option, but cannot stay available after GUI quit.
- Prefer a separate Node-only runner with a GUI manager. A shared runner core can also run in a managed child. Independent availability after GUI quit needs an explicit user login service/daemon plus update/uninstall rules; merely forking does not establish that promise. Bundle a runtime or require Node. Electron utility-process lifecycle must not be mistaken for an independent service.
- Expected runner production source: roughly 1800-2800 LOC across 7-10 files, including transport, filesystem/handles, process/job control, git execution, root policy, credential/config, and facts. Do not include the model runtime. Tests and GUI management add code beyond this.
- A selectively bundled Durable NodeExecutionEnv can reuse filesystem/process primitives; its source is Node-only, but installing all pi-durable dependencies also brings model/runtime/image packages. Avoid taking the full runtime accidentally. There is no installed pi-env package in this checkout; Durable README mentions one, but this investigation did not verify its availability/API.
- `/home/nohj/pi-pocket/src/server/git.ts:28-56`: `git()` directly invokes local `execFile` with argv, `core.fsmonitor=false`, `GIT_LITERAL_PATHSPECS=1`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`. The workspace agent must route this through the remote executor or a typed runner git operation, preserving flags, output bounds, and cancellation. Repository config can run filters/hooks; git is not a sandbox.
- A runner must enforce locally approved canonical roots, symlink/junction behavior, write-parent checks, and temporary/spill allowances. This prevents accidental API path escape, not arbitrary shell escape.
- Unrestricted bash can access everything the OS user can access, regardless of its cwd. A real allowed-folders security boundary for bash requires OS isolation, not a path prefix check. Make the permission explicit or add a separate sandbox project.
- Electron 45.1.0 installed type declarations expose async safeStorage methods. Linux may select `basic_text`; do not assume that an available API means an OS-backed secure store. Store no runner secrets in ordinary renderer settings.

## H. Agent facts
- `/home/nohj/pi-pocket/src/server/extensions/prompt.ts:108-119`: cwd comes from `input.env`, but the platform comes from server `process.platform`. Resource loading at `:70-105` uses local `loadProjectContextFiles` and `host.skills`, cached only by cwd.
- Replace the environment section with a stable approved snapshot: environment label/ID, runner availability, cwd, OS/arch, native path rules, selected shell, allowed roots/permission scope, and known tool versions. Cache by environment, not cwd alone. Avoid putting an always-changing heartbeat/time into the prompt.
- Add an environment-info read-only tool for fresh bounded facts: shell, git, node, rg/fd availability and versions, process limits, optional capabilities. Redact environment variables and credentials. Use argv for version commands, deadlines, and output caps.
- `/home/nohj/pi-pocket/src/server/host.ts`: add a narrow environment/facts lookup for prompt extensions if needed; reserve the tool name in reload.ts and update public types when extending PocketHost.
- Dependency on resource agent: remote AGENTS.md/skills/project defaults need remote trusted loading. Server docs paths in the prompt are not readable by the runner's read tool; give server-resource access or document an alternative.

## Estimate ledger

These are implementation estimates from the verified call graph, not measured patches. LOC includes new tests/docs. Added and changed lines are separate. Rows share protocol, runner, and test files, so do not sum them as a unique total. Full browser/workspace/resource conversion and an OS-enforced shell sandbox are outside these numbers.

| Item | Difficulty | Added LOC | Changed LOC | Files | Example file kinds/paths |
| --- | --- | --- | --- | --- | --- |
| A | 4 | 1100-1700 | 100-180 | 8-11 | server main.ts/http.ts/http/api.ts/auth.ts/config.ts; new runners/protocol/routes; GUI pairing; auth/protocol tests; desktop docs |
| B | 4 | 1000-1700 | 80-140 | 6-8 | server app.ts/reload.ts/hidden.ts; new remote env/search; runner FS methods; env/tool tests |
| C | 5 | 1100-1700 | 200-350 | 7-10 | server background.ts/shell.ts/docs.ts/extensions/background.ts; runner jobs/process backend; restart/job tests; docs |
| D | 5 | 700-1200 | 100-200 | 6-9 | server runner waits/room.ts/app.ts; web store/live status; runner receipts/cancel; failure/restart tests; docs |
| E | 3 | 450-800 | 200-350 | 8-12 | server docs.ts/config.ts/commands.ts/app.ts/linked-sessions.ts/extensions/subagents.ts; settings UI; inheritance tests; docs |
| F | 3 | 350-600 | 150-250 | 6-9 | web sheets/folder.js/store.js/style.css; server fs/favorites routes; UI tests; docs |
| G | 4 | 2100-3200 | 100-200 | 10-14 | runner modules; GUI main manager/index/settings/desktop.ts, preload/server.ts, shared/types; packaging metadata; tests/docs |
| H | 2 | 200-350 | 70-120 | 6-9 | server extensions/prompt.ts/host.ts/app.ts/reload.ts; facts tool; runner info; public types; prompt tests/docs |

Difficulty reasons: A has a new authenticated transport and reconnect state. B must bridge two tool APIs and native paths. C combines process survival, local logs, and 3 OS families. D has ambiguous effects across failures. E needs atomic inherited identity and policy. F extends an existing picker. G adds a security-sensitive native program and lifecycle. H mostly exposes bounded facts, but remote resource loading is a separate dependency.
