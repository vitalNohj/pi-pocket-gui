# Remote folder feature audit

Read-only source audit of `/home/nohj/pi-pocket`, revision `aece3eb29af29736d32856fdb1e9ec44d426b146`. No project file changed. No server process changed. No test or build ran.

## Answer

Use Pi Durable's existing `ExecutionEnv`. Do not introduce a second general filesystem abstraction. The current app already has `PocketApp.envFor(id)`, but these features bypass it. Resolving an environment only by `cwd` is unsafe. The access identity must include the environment ID.

The interface is in `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-durable/dist/env/index.d.ts`. It already has `id`, `cwd`, `absolutePath`, `joinPath`, `canonicalPath`, `fileInfo`, `exists`, `openBinaryReader`, `openDirReader`, optional `listFiles`, `watch`, `writeFile`, `renameFile`, `createDir`, `remove`, and argv `exec` with separate stdout/stderr, cancellation, and output windows. `BinaryReader.info/read/close` bind reads to one opened regular file. `openBinaryReader` can refuse a final symlink. `fileInfo` uses lstat semantics in the Node implementation, not stat semantics. The current folder picker follows directory symlinks. Preserve this difference deliberately.

Missing high-level semantics include exclusive upload creation and streaming writes, atomic bounded exports, checked root-bound opens, and runner-local operations that batch many filesystem calls. Generic `writeFile` can follow symlinks. It does not express the current exclusive creation flags or the export's link policy. A local `realpath` followed by a remote `open` is not a safe substitute. Execute related checks and operations on the runner. Preserve existing policies and test path-swap races. Existing path checks are not a universal sandbox.

`/home/nohj/pi-pocket/src/server/app.ts:1352` constructs access with `wrapEnv`; its `#env` caches `NodeExecutionEnv` by folder. This is the common starting point, not the complete migration. Environment identity must also reach synchronous host APIs and extension routes. This is a dependency on the runner and extension teams.

## Count rules

The following counts are static call-expression sites for imports from `node:fs`, `node:fs/promises`, and `node:child_process`. The TypeScript parser generated the list. Loops count once. Calls through a `FileHandle` appear separately below. Imports, pure path calls, and delegated SDK/Git calls do not inflate the direct count. The detailed JSON is `/tmp/remote-folders-call-sites.json`.

A raw count does not mean all calls move remotely. The annotations identify server data and mixed-purpose helpers.

## Direct call inventory

### `/home/nohj/pi-pocket/src/server/workspace.ts` — 6 direct calls

- `/home/nohj/pi-pocket/src/server/workspace.ts:175`: `checkDirectory` calls `statSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/workspace.ts:192`: `checkDirectory` calls `lstatSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/workspace.ts:231`: `makeFolder` calls `mkdirSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/workspace.ts:268`: `real` calls `realpathSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/workspace.ts:310`: `real` calls `realpathSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/workspace.ts:503`: `uploadDirectory` calls `mkdirSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/files.ts` — 3 direct calls

- `/home/nohj/pi-pocket/src/server/files.ts:87`: `readSome` calls `opendir` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/files.ts:276`: `viewFile` calls `stat` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/files.ts:296`: `viewFile` calls `open` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/changes.ts` — 6 direct calls

- `/home/nohj/pi-pocket/src/server/changes.ts:80`: `realpathWithMissingTail` calls `realpathSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/changes.ts:291`: `versionOf` calls `lstat` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/changes.ts:351`: `count` calls `lstat` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/changes.ts:474`: `revertFile` calls `rm` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/changes.ts:493`: `revertFile` calls `rm` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/changes.ts:500`: `revertFile` calls `rm` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/git.ts` — 1 direct calls

- `/home/nohj/pi-pocket/src/server/git.ts:32`: `git` calls `execFile` (node:child_process).

### `/home/nohj/pi-pocket/src/server/branches.ts` — 3 direct calls

- `/home/nohj/pi-pocket/src/server/branches.ts:55`: `gitDirOf` calls `statSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/branches.ts:62`: `gitDirOf` calls `readFileSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/branches.ts:81`: `headOf` calls `readFileSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/worktrees.ts` — 8 direct calls

- `/home/nohj/pi-pocket/src/server/worktrees.ts:46`: `copyNewFiles` calls `lstat` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:57`: `copyNewFiles` calls `mkdir` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:58`: `copyNewFiles` calls `copyFile` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:104`: `createWorktree` calls `mkdirSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:129`: `real` calls `realpathSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:150`: `sourceFolders` calls `realpathSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:162`: `sourceFolders` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/worktrees.ts:171`: `removeWorktree` calls `existsSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/skills.ts` — 8 direct calls

- `/home/nohj/pi-pocket/src/server/skills.ts:50`: `gitRoot` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:70`: `projectAgentsFolders` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:115`: `canonical` calls `realpathSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:163`: `projectDistrusted` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:172`: `skillPlaces` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:185`: `skillPlaces` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:216`: `readProjectTrust` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/skills.ts:217`: `readProjectTrust` calls `existsSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/prompts.ts` — 5 direct calls

- `/home/nohj/pi-pocket/src/server/prompts.ts:34`: `readTemplate` calls `readFileSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/prompts.ts:64`: `isFile` calls `statSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/prompts.ts:75`: `templatesIn` calls `readdirSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/prompts.ts:108`: `loadPromptTemplates` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/prompts.ts:243`: `expandSkillCommand` calls `readFileSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/memory.ts` — 2 direct calls

- `/home/nohj/pi-pocket/src/server/memory.ts:98`: `projectOf` calls `realpath` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/memory.ts:110`: `projectOf` calls `realpath` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/project-model.ts` — 1 direct calls

- `/home/nohj/pi-pocket/src/server/project-model.ts:52`: `projectModelDefault` calls `readFileSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/pi-sessions.ts` — 2 direct calls

- `/home/nohj/pi-pocket/src/server/pi-sessions.ts:494`: `read` calls `stat` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/pi-sessions.ts:498`: `read` calls `readFile` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/hidden.ts` — 0 direct calls

No direct imported filesystem or process call. Delegation can still require a change.

### `/home/nohj/pi-pocket/src/server/lancet.ts` — 2 direct calls

- `/home/nohj/pi-pocket/src/server/lancet.ts:112`: `<module>` calls `existsSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/lancet.ts:258`: `#switchedOn` calls `readFileSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/watches.ts` — 0 direct calls

No direct imported filesystem or process call. Delegation can still require a change.

### `/home/nohj/pi-pocket/src/server/repo-watches.ts` — 0 direct calls

No direct imported filesystem or process call. Delegation can still require a change.

### `/home/nohj/pi-pocket/src/server/github.ts` — 1 direct calls

- `/home/nohj/pi-pocket/src/server/github.ts:21`: `runGh` calls `execFile` (node:child_process).

### `/home/nohj/pi-pocket/src/server/extensions/artifacts.ts` — 1 direct calls

- `/home/nohj/pi-pocket/src/server/extensions/artifacts.ts:47`: `readFileBytes` calls `open` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/extensions/prompt.ts` — 1 direct calls

- `/home/nohj/pi-pocket/src/server/extensions/prompt.ts:64`: `trustChanged` calls `statSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/design/files.ts` — 6 direct calls

- `/home/nohj/pi-pocket/src/server/design/files.ts:8`: `writeExport` calls `realpath` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/files.ts:20`: `writeExport` calls `mkdir` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/files.ts:25`: `writeExport` calls `lstat` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/files.ts:33`: `writeExport` calls `open` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/files.ts:42`: `writeExport` calls `rename` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/files.ts:45`: `writeExport` calls `rm` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/design/system.ts` — 10 direct calls

- `/home/nohj/pi-pocket/src/server/design/system.ts:36`: `systemDirectory` calls `lstatSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:102`: `readDesignSystemText` calls `lstatSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:118`: `readDesignSystemText` calls `openSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:121`: `readDesignSystemText` calls `fstatSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:130`: `readDesignSystemText` calls `readSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:145`: `readDesignSystemText` calls `closeSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:160`: `writeDesignSystemText` calls `mkdirSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:168`: `writeDesignSystemText` calls `writeFileSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:171`: `writeDesignSystemText` calls `renameSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/design/system.ts:174`: `writeDesignSystemText` calls `rmSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/design/export.ts` — 0 direct calls

No direct imported filesystem or process call. Delegation can still require a change.

### `/home/nohj/pi-pocket/src/server/design/index.ts` — 0 direct calls

No direct imported filesystem or process call. Delegation can still require a change.

### `/home/nohj/pi-pocket/src/server/design/guide.ts` — 0 direct calls

No direct imported filesystem or process call. Delegation can still require a change.

### `/home/nohj/pi-pocket/src/server/design/render.ts` — 3 direct calls

- `/home/nohj/pi-pocket/src/server/design/render.ts:544`: `withRender` calls `mkdtemp` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/render.ts:583`: `withRender` calls `rm` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/design/render.ts:587`: `withRender` calls `rm` (node:fs/promises).

### `/home/nohj/pi-pocket/src/server/http/api.ts` — 2 direct calls

- `/home/nohj/pi-pocket/src/server/http/api.ts:578`: `createApi` calls `readdirSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/api.ts:587`: `createApi` calls `statSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/http/conversation-routes.ts` — 3 direct calls

- `/home/nohj/pi-pocket/src/server/http/conversation-routes.ts:436`: `conversationRoutes` calls `open` (node:fs/promises).
- `/home/nohj/pi-pocket/src/server/http/conversation-routes.ts:737`: `conversationRoutes` calls `createWriteStream` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/conversation-routes.ts:742`: `conversationRoutes` calls `rmSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/http/assets.ts` — 8 direct calls

- `/home/nohj/pi-pocket/src/server/http/assets.ts:153`: `readNow` calls `statSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:161`: `readNow` calls `readFileSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:246`: `serveApp` calls `readFileSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:362`: `serveImage` calls `statSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:371`: `serveImage` calls `openSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:374`: `serveImage` calls `readSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:376`: `serveImage` calls `closeSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/http/assets.ts:409`: `serveImage` calls `createReadStream` (node:fs).

### `/home/nohj/pi-pocket/src/server/commands.ts` — 3 direct calls

- `/home/nohj/pi-pocket/src/server/commands.ts:203`: `modelImage` calls `readFileSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/commands.ts:1081`: `#mentionedFiles` calls `statSync` (node:fs).
- `/home/nohj/pi-pocket/src/server/commands.ts:1098`: `#mentionedFiles` calls `statSync` (node:fs).

### `/home/nohj/pi-pocket/src/server/reveal.ts` — 2 direct calls

- `/home/nohj/pi-pocket/src/server/reveal.ts:54`: `run` calls `spawn` (node:child_process).
- `/home/nohj/pi-pocket/src/server/reveal.ts:88`: `reveal` calls `statSync` (node:fs).

## Call-count qualifications

- `/home/nohj/pi-pocket/src/server/workspace.ts`: 5 calls use a selected project folder. `uploadDirectory` adds 1 `mkdirSync` for server-managed uploads. `conversationPath` has no filesystem call, but its `resolve` and `expandHome` use server path semantics. `conversationFile` and `readableFile` canonicalize roots on the current machine. Root checks and file opens must use one environment. The upload lineage spans up to 64 ancestors. Server uploads and runner project paths need separate namespaces.
- `/home/nohj/pi-pocket/src/server/files.ts`: add `handle.read` and `handle.close` to the 3 imported calls. `gitFiles` delegates once to `git`. `readSome` uses bounded directory iteration. `walkFiles` must not become one network request per directory. `FileLists` caches 16 folders by bare cwd. A list can contain 100,000 paths. Outside Git, the walk stops at 50,000 files or 3 seconds. Freshness is 2–60 seconds. The viewer reads at most 512 KiB and lists at most 1,000 directory entries. Keep list construction on the runner. The existing `ExecutionEnv.listFiles` is not an exact replacement for `git ls-files`: it can exclude tracked files that match ignores and uses depth-first traversal rather than the app's bounded breadth-first fallback.
- `/home/nohj/pi-pocket/src/server/changes.ts`: all 6 imported calls use the project. `realpathWithMissingTail` can resolve many ancestors per recorded edit. `versionOf` uses `lstat`; `changesIn` has another `lstat` for untracked file counting; `revertFile` has 3 `rm` sites. `diffOf` delegates to Git. Parsing history with `editFacts` can stay on the server, but canonicalize recorded paths remotely in batches. Current limits: 500 changed files, 300,000 diff characters, 2,000,000 counted bytes per untracked file, 8 count operations concurrently, 15-second Git timeout, 1,200,000-byte process buffer. Limit counting concurrency for the runner. A naive implementation adds hundreds of round trips. Truncate diffs at the runner before transmission, not only after collecting them on the server. Binary Git diffs have no line counts. Use the runner's null-device path, not the server's `devNull`.
- `/home/nohj/pi-pocket/src/server/git.ts`: 1 `execFile` site serves all folder-related Git callers. Preserve argv, exit-code allowances, timeouts, buffer limits, `core.fsmonitor=false`, literal pathspecs, optional-lock suppression, and English errors. Programs configured by the repository can still execute, including filters. Do not send the server's `process.env` to the runner. Use the runner environment plus approved explicit variables.
- `/home/nohj/pi-pocket/src/server/branches.ts`: `gitDirOf` has 1 stat and 1 read site. `headOf` has 1 HEAD read. The walk can repeat the stat at each ancestor. `branchesIn`, `validBranchName`, `isRemoteBranch`, and `switchBranch` also use delegated Git. Branch listing caps each list at 1,000. `/home/nohj/pi-pocket/src/server/room.ts:435` polls HEAD every 3,000 ms and reads it synchronously during updates. Use asynchronous refresh into a cached room field. Optional runner watches must report overflow/reconnect so the cache can rescan. There is no existing project `fs.watch` here to migrate.
- `/home/nohj/pi-pocket/src/server/worktrees.ts`: all 8 calls touch project/worktree files. `copyNewFiles` has lstat/mkdir/copyFile; `createWorktree` creates the parent; `inWorktree` canonicalizes paths; `sourceFolders` uses realpath plus exists; `removeWorktree` tests existence. `repositoryOf`, `discardWorktree`, creation, and removal delegate to Git. Worktrees currently live under the server's `dataDir/worktrees`. A runner needs its own managed root. Copy the untracked files runner-to-runner, not through the socket. The aggregate copy limit is 50 MiB. `sourceFolders` returns a synchronous callback that probes existence, so it needs a batch mapping or a redesign, not only asynchronous fs replacements. `/home/nohj/pi-pocket/src/server/commands.ts:547` checks busy and sharing sessions with bare paths. Scope these comparisons by environment. Use a mutation receipt for creation/removal. A lost socket response after `git worktree add` must not create a second worktree or lose the first one. Preserve rollback and source restoration for subagents.
- `/home/nohj/pi-pocket/src/server/skills.ts`: 7 direct sites can touch the project; the eighth, `existsSync` in the user-folder filter in `skillPlaces`, tests server-global folders. Direct project access occurs in `gitRoot`, `projectAgentsFolders`, `canonical`, `projectDistrusted`, `skillPlaces`, and `readProjectTrust`. `loadSessionSkills` and `readProjectTrust` delegate to SDK `loadSkills`. `savedDecision` and `saveProjectTrust` delegate to SDK `ProjectTrustStore`, which canonicalizes paths on its own machine. Trust must not apply to another machine with the same pathname. Keep local trust compatibility. Define a separate environment-scoped remote trust identity, or explicitly use a runner trust store. This choice is not settled by an fs adapter.
- `/home/nohj/pi-pocket/src/server/prompts.ts`: 5 mixed-purpose direct sites serve global and project resources: `readTemplate→readFileSync`, `isFile→statSync`, `templatesIn→readdirSync`, `loadPromptTemplates→existsSync`, `expandSkillCommand→readFileSync`. These APIs are synchronous today. Server-global skills/templates must remain available without pretending their paths exist on the runner. Remote tools need a resource namespace, copied resources, or a server-side resource-read dispatch. Preserve resource precedence and resolve relative settings paths deliberately. This is a dependency on the tool and extension teams.
- `/home/nohj/pi-pocket/src/server/extensions/prompt.ts`: its only direct fs call is `trustChanged→statSync` for server `trust.json`; it is not a project call. `createPrompt`'s local `load` delegates to SDK `loadProjectContextFiles` and `host.skills`. The project resources cache is 30 seconds and keyed by bare cwd. It is a polling cache, not a native watcher. Make the load asynchronous or consume a runner snapshot. The environment prompt currently prints server `process.platform`. It must show the selected environment's platform.
- `/home/nohj/pi-pocket/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:115`: `loadContextFileFromDir` has 3 direct fs sites: `existsSync`, `statSync`, `readFileSync`. It tries `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`, in order. `loadProjectContextFiles` at line 165 loads global context plus every ancestor and handles a linked worktree's shadowed main-repository context. Its helpers `findGitPaths` and `canonicalizePath` also use host filesystem access. This app does not instantiate `DefaultResourceLoader` for these sections. An SDK loader accepts paths, not the app's `ExecutionEnv`. An injected fs shim does not solve it. Reuse the loader on the runner or implement an asynchronous parity-tested snapshot adapter.
- `/home/nohj/pi-pocket/src/server/memory.ts`: both direct `realpath` sites are in `projectOf`. The function also delegates Git common-directory detection, with a fallback for older Git. Cache and lesson project keys use a bare canonical common Git directory, or canonical cwd outside Git. Add environment identity, but retain existing local lesson keys. Do not merge two remote clones automatically because their URLs match. Define offline behavior: reuse a known project identity or report unavailable. Do not fall back to looking at the same path on the server.
- `/home/nohj/pi-pocket/src/server/project-model.ts`: only `projectModelDefault→readFileSync` reads the project file. `globalModelSettings` uses SDK `SettingsManager.create` with `projectTrusted:false`; those global reads stay server-side. `projectModelTrusted` uses `ProjectTrustStore`, which needs the same remote trust change as skills. Read the final runner cwd after worktree creation. Keep validation and precedence: owner default, trusted project pair, last selected pair, global pair, none. An invalid trusted project file must stop creation, not choose another paid model. Only new sessions use these settings.
- `/home/nohj/pi-pocket/src/server/pi-sessions.ts`: neither direct call reads a project folder. `read→stat/readFile` reads the terminal Pi JSONL store. `#find` delegates the scan to `SessionManager.listAll`. `preview` and `/home/nohj/pi-pocket/src/server/commands.ts:470` validate the JSONL header's cwd through Workspace. The simplest first release keeps import explicitly server-only. Remote import needs environment-aware list/preview/read routes, runner-local SDK scanning or compatible parsing, environment-scoped session IDs, and a safe transfer of up to 32 MiB. Do not reinterpret a server terminal session's cwd as a remote path. `/home/nohj/pi-pocket/web/sheets/pi-sessions.js` currently says “this computer,” although it means the server.
- `/home/nohj/pi-pocket/src/server/extensions/artifacts.ts`: add `handle.stat`, `handle.read`, `handle.close` to its 1 `open` site in `readFileBytes`. `publish` reads both the main `path` and each asset `path` through this helper. Final symlinks are refused; parent links are permitted. It bounds reads to one byte past the limit even if a file grows. Artifact UTF-8 text is limited to 2,000,000 bytes. Each asset is limited to 5,000,000 bytes; 200 assets and 20,000,000 bytes total. Binary assets must not pass through text conversion. Content/edit-only artifacts already work without project access. The durable artifact store and public serving can stay on the server. Update “Server-local” tool descriptions.
- `/home/nohj/pi-pocket/src/server/design/files.ts`: 6 imported calls in `writeExport`, plus `handle.writeFile` and 2 explicit `handle.close` calls. Root canonicalization, parent checks, creation, temporary write, rename, and cleanup belong in one runner-side operation. Keep the export inside the session folder, reject directory symlinks, and replace the target atomically. Do not emulate this by unrelated network calls.
- `/home/nohj/pi-pocket/src/server/design/system.ts`: all 10 imported calls touch `.pi/design-system.md` or its directory/temp file. `systemDirectory` checks `.pi`; `readDesignSystemText` checks and opens a regular file with no final symlink; `writeDesignSystemText` writes a fresh exclusive temp file and renames it. Limit is 16,384 bytes. `designSystemTool` and `/home/nohj/pi-pocket/src/server/design/guide.ts` call these synchronous helpers. The guide must become asynchronous or use a validated snapshot.
- `/home/nohj/pi-pocket/src/server/design/export.ts`: no direct calls. `saveDesignExport` calls `writeExport`. `/home/nohj/pi-pocket/src/server/design/index.ts`: no direct calls; both the `design_export` tool and `designRoutes` pass only `cwd`, so they need environment access. The route then downloads through the core download endpoint. `/home/nohj/pi-pocket/src/server/design/bundle.ts` reads durable docs, not the project. `/home/nohj/pi-pocket/src/server/design/render.ts` has 3 temporary-profile fs calls, all server-only. Keep rendering on the server. Export binaries can be large; PPTX render images cap at 100,000,000 bytes. Use cancellation and bounded chunks. A design download may otherwise transfer server→runner→server→browser. A direct-download option can avoid that transfer when no project write is needed, but this changes the feature contract.
- `/home/nohj/pi-pocket/src/server/hidden.ts`: 0 direct fs/process calls. Keep `wrapEnv` around the selected remote base so `CommandEnvs.for` runs before RPC and `HiddenValues.stream/result` runs before storage/display. `CommandRun` identifies only conversation/command/cwd; providers need an environment identity to avoid selecting the wrong secrets. Define explicit permission to transfer extension-injected secrets. Never transfer server process.env or model-provider credentials. Redaction hides exact known strings, not deliberate encodings. Cancellation, stdout/stderr ordering, skipped-output boundaries, and spill-file access need remote tests.
- `/home/nohj/pi-pocket/src/server/lancet.ts`: its 2 direct calls discover the server guard package and read the server guard settings; neither reads the project. `judge` delegates to `modules.judgePath(target,cwd,settings)` and hardcodes the shell as `bash` for `judgeCommand`. `/home/nohj/pi-pocket/src/server/extensions/guard.ts` supplies only agent cwd. Keep command classification and approvals on the server, but provide remote platform/home/canonical path data for path rules, or move the path-rule step to the runner. The external guard source was absent at both built-in default locations, so its internal path I/O could not be confirmed. Do not silently bypass an enabled guard. Disable unsupported remote tools if correct guarding is unavailable. Existing missing/off guard behavior is a separate current policy, not a recommendation to widen it.
- `/home/nohj/pi-pocket/src/server/watches.ts` and `/home/nohj/pi-pocket/src/server/repo-watches.ts`: 0 direct filesystem/process calls each. `Watches.start` uses `originRepo` twice and `gh pr view` with session cwd. `/home/nohj/pi-pocket/src/server/github.ts:279` implements `originRepo` via the shared Git helper. Resolve origin and current branch on the runner. Then use explicit repository/PR arguments with server `gh`. The sole `runGh→execFile` site can remain on the server. Later PR looks and repository watches already use explicit repository identifiers and server GitHub credentials. They do not need a runner filesystem watcher. Define whether watches continue while a runner is offline. Preserving their current server-side polling is simpler and avoids moving GitHub credentials.
- `/home/nohj/pi-pocket/src/server/http/api.ts`: 2 project/folder-list calls in the `GET /api/fs` route. `POST /api/fs` delegates to `Workspace.makeFolder`. Root/home/recent folders and favorite folders must refer to the chosen environment. `/home/nohj/pi-pocket/src/server/folder-favorites.ts` stores bare paths in a durable document; no direct filesystem call, but its schema must include environment identity. `/home/nohj/pi-pocket/web/sheets/folder.js` assumes slash-based absolute paths, “Computer” at `/`, and server home. Windows support is a product decision, not a small fs replacement.
- `/home/nohj/pi-pocket/src/server/http/conversation-routes.ts`: `download` has 1 imported `open`, plus `handle.stat`, `handle.createReadStream`, and `handle.close`. `upload` has 2 imported calls: `createWriteStream` and cleanup `rmSync`, both server storage today. The `submit` filter accepts only server upload paths. Browser uploads cap at 50 MiB. Keep attachments server-managed and copy/materialize them on the runner, or define an attachment resource capability for tools. Do not insert a server absolute path into a remote tool instruction and claim it is usable. Preserve inherited/fork upload access. The image/file route delegates `serveImage`; the reveal route delegates `reveal`.
- `/home/nohj/pi-pocket/src/server/http/assets.ts`: only 5 of the 8 direct calls touch a session file, all in `serveImage`: `statSync`, `openSync`, `readSync`, `closeSync`, `createReadStream`. Keep the 3 static-web-file calls local. Preserve image sniffing, size limits, CSP, ETags, and the regular-file restriction on remote reads. `/home/nohj/pi-pocket/src/server/commands.ts`: 2 `statSync` sites in `#mentionedFiles`, and 1 `readFileSync` in `modelImage`. Fetch validated bytes from the runner, then resize on the server. File mentions are capped; handle a missing remote file as unavailable, not a local fallback.
- `/home/nohj/pi-pocket/src/server/reveal.ts`: `reveal→statSync` plus `run→spawn`, 1 each. Redirect reveal to an owner-approved runner/desktop action or disable it for remote sessions. Never open the coincident path in the server's file manager.

## UI and API dependencies

Representative files: `/home/nohj/pi-pocket/web/sheets/folder.js`, `/home/nohj/pi-pocket/web/files.js`, `/home/nohj/pi-pocket/web/files-panel.js`, `/home/nohj/pi-pocket/web/sheets/file.js`, `/home/nohj/pi-pocket/web/diff.js`, `/home/nohj/pi-pocket/web/sheets/branch.js`, `/home/nohj/pi-pocket/web/sheets/worktree.js`, `/home/nohj/pi-pocket/web/trust.js`, `/home/nohj/pi-pocket/web/sheets/pi-sessions.js`, `/home/nohj/pi-pocket/web/store.js`, and `/home/nohj/pi-pocket/src/server/extensions/design/workspace.js`. Most existing conversation routes can preserve their response shape. Add availability/offline capabilities and environment-specific home labels. Invalidate caches when the environment changes even when cwd is unchanged. The browser team owns broader selector/session metadata integration. The extension team owns the new host/route capability. The runner team owns transport, per-operation cancellation, binary chunks, reconnection, and machine-local secure primitives.

## Estimates

These are incremental added-plus-changed LOC, including focused tests and documentation. They assume the shared runner transport and per-session environment persistence already exist. File counts include server, web, runner, docs, and tests where listed. Shared files overlap; do not add file counts to infer a unique total. Runner paths below are proposed examples, not existing files.

| Item | Difficulty | LOC | Files | Representative kinds and paths |
| --- | --- | --- | --- | --- |
| Access seam hardening | 4 | 300–500 | 5–7 | Server `/home/nohj/pi-pocket/src/server/folder-access.ts` (new), `/home/nohj/pi-pocket/src/server/app.ts`; runner `folder-access.ts` (new package path TBD); conformance tests; docs |
| Folder picker and authorization | 3 | 350–600 | 7–10 | Server Workspace/API/paths/favorites; web folder/store; runner directory operation; tests; docs |
| Files, mentions, transfers | 4 | 600–1,000 | 10–15 | Server files/commands/assets/conversation routes; web files/viewer/composer; runner transfer; tests; docs |
| Changes, review, branches | 4 | 450–750 | 8–12 | Server changes/git/branches/room/workspace; web diff/branch; runner Git summary; tests; docs |
| Worktrees | 4 | 400–700 | 8–11 | Server worktrees/commands/docs schema; web worktree/folder; runner receipt/copy; tests; docs |
| Skills, templates, context | 4 | 600–1,000 | 9–14 | Server skills/prompts/prompt extension/app/host; web trust/store; runner resource snapshot; parity tests; docs |
| Memory, defaults, import scope | 3 | 300–550 | 7–10 | Server memory/project-model/pi-sessions/commands; web import label/capabilities; runner identity/settings read; tests; docs |
| Artifacts and Design | 4 | 400–750 | 9–13 | Server artifacts/design files/system/export/index/guide; design workspace web; runner secure read/write; tests; docs |
| Secrets, guard, GitHub watches | 4 | 350–650 | 8–12 | Server hidden/lancet/guard extension/watches/github/repo-watches; runner path facts; capability UI; tests; docs |

Remote CLI import is not included in the import-scope estimate. If required, add about 250–450 LOC and 4–6 touched files, difficulty 3–4, including tests. Full Windows path and shell support is also excluded. Keep local behavior intact with the existing tests. Add remote fake-environment tests, disconnect-after-mutation tests, symlink/path-swap tests, cross-environment path collision tests, large/binary transfer tests, and actual runner tests through the real app. No tests ran in this read-only audit.

## Principal open questions

1. Which operating systems must the first release support? The web picker, `node:path`, `devNull`, and guard shell assumptions are not portable by declaration alone.
2. Where does remote project trust live? Who can grant it? Trust must include environment identity, not only a path string.
3. Can server-global skill resources be read through remote tools without copying their whole server namespace?
4. Are uploaded files server-owned attachments or runner-owned files? How do forks retain access when the runner is offline?
5. Which runner operations must have durable receipts? Worktree creation/removal and exclusive uploads need an unknown-outcome policy after disconnect.
6. Can extensions transfer selected secrets to a runner? Who consents? Never infer this permission from folder access alone.
7. Can server GitHub watches continue while the runner is offline? Explicit stored repo/PR identity makes this practical.
8. Are remote terminal Pi imports a requirement, or can the first release label them server-only?

## Representative verification and documentation paths

Existing focused tests include `/home/nohj/pi-pocket/test/files.test.ts`, `/home/nohj/pi-pocket/test/folder-favorites.test.ts`, `/home/nohj/pi-pocket/test/changes.test.ts`, `/home/nohj/pi-pocket/test/changes-counts.test.ts`, `/home/nohj/pi-pocket/test/branches.test.ts`, `/home/nohj/pi-pocket/test/worktrees.test.ts`, `/home/nohj/pi-pocket/test/skills.test.ts`, `/home/nohj/pi-pocket/test/prompts.test.ts`, `/home/nohj/pi-pocket/test/memory.test.ts`, `/home/nohj/pi-pocket/test/pi-sessions.test.ts`, `/home/nohj/pi-pocket/test/artifact-bundles.test.ts`, `/home/nohj/pi-pocket/test/design-system-safety.test.ts`, `/home/nohj/pi-pocket/test/design-routes.test.ts`, `/home/nohj/pi-pocket/test/lancet.test.ts`, and `/home/nohj/pi-pocket/test/repo-watches.test.ts`. Add a new `/home/nohj/pi-pocket/test/remote-folder-access.test.ts` for environment collisions, disconnects, and transfer behavior. These tests were not run.

Relevant documentation examples are `/home/nohj/pi-pocket/docs/architecture.md`, `/home/nohj/pi-pocket/docs/features.md`, `/home/nohj/pi-pocket/docs/customizing.md`, and the appropriate extension reference pages. A runner operation file such as `runner/src/folder-access.ts` is only a proposed name. The runner's package location belongs to the runner team.

`/home/nohj/pi-pocket/src/server/design/bundle.ts` and `/home/nohj/pi-pocket/src/server/design/pptx.ts` have 0 direct filesystem/process imports. They read durable artifact documents or construct bytes. They need no folder-access migration.
