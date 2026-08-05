# Postmortem, Chrome silently stopped opening, 2026-08-05

**Severity**: Medium (local development machine only; the deployed app and CI were never affected)
**Status**: Resolved; hardened with a one-command revive script, driver self-cleanup, and a pre-push Chrome health check
**Symptoms**: Clicking Google Chrome did nothing — no window, no error dialog, no crash banner. The app icon bounced (or not), and Chrome silently exited. All verification scripts that spawn headless Chrome (the screenshot gallery, sign-in proofs, the live tour) kept failing with `Chrome DevTools did not come up.`

## What happened

Chrome's main process (PID 634, launched 2026-08-03 08:40) ran for roughly two days and then crashed at 2026-08-05 15:30. The crash report (`~/Library/Logs/DiagnosticReports/Google Chrome-2026-08-05-153041.ips`, incident `A15A3E9E`) shows a deliberate trap, not a random fault:

- **Exception**: `EXC_BREAKPOINT` / `SIGTRAP` ("Trace/BPT trap: 5") on the **main browser process** (`CrBrowserMain`, faulting thread 0) — not a renderer and not the GPU process.
- **Stack**: the main thread was committing a CoreAnimation transaction (`CA::Transaction::commit()`) while the window's titlebar was being re-laid out (`NSThemeFrame _updateTitlebarContainerViewFrameIfNecessary` → `NSTitlebarContainerView setFrameSize:` → `NSView setFrameSize:`). That path runs through AppKit's remote-view drawing synchronization (`-[NSRemoteView …]` and `NSVB_AnimationFencingSupport _synchronizeDrawingAcrossProcessesOverPort:andPreCommitHandler:`), and the frames then fall straight into `exit` + `__cxa_finalize_ranges`.

So the crash is in Chrome's own macOS window-layer integration: a window geometry/titlebar change synchronized through AppKit's animation-fencing remote view hit a fence/state failure and Chrome deliberately trapped and exited. This is a known Chrome-on-macOS crash family (not a renderer OOM, not a GPU fault, and not a macOS-incompatibility per se). It was likely aggravated by how long the process had been up (two days, hundreds of threads) and by whatever window operation triggered the relayout at 15:30.

## Why Chrome then refused to open

The crash left three stale **Singleton lock files** in the real profile pointing at the dead process:

```
~/Library/Application Support/Google/Chrome/
  SingletonCookie -> 12721472264408385362
  SingletonLock   -> Laredjs-MacBook-Air-2.local-634   (634 = the crashed PID)
  SingletonSocket -> …/com.google.Chrome.j95WNq/SingletonSocket (dead socket)
```

On launch, Chrome checks `SingletonLock`/`SingletonSocket`; when they point at a process that no longer exists, it concludes another instance is already running and exits silently. That is the exact "opens and immediately disappears" failure. The crash and the lock files together made the browser unusable, and every headless verifier that shells out to the same Chrome binary inherited the breakage.

Compounding the mess, our own capture and verification scripts (`capture-gallery.mjs`, `verify-prod-signin.mjs`, `verify-prod-matrix.mjs`, `tour-live.mjs`) spawn headless Chrome with throwaway `/tmp` profiles, and interrupted runs left instances and profile directories behind.

## The fix

1. **Manual recovery** (the immediate fix): killed the leftover headless instances, removed the three `Singleton*` locks from the real profile (Chrome recreates them on its next clean start — no profile data is ever touched), and relaunched. Chrome came back up as PID 6197 and has been healthy since.
2. **`scripts/chrome-revive.sh`** (new, committed): packages that recovery into one command. It sweeps stale headless capture instances, removes the Singleton locks only when no real GUI Chrome is alive (it distinguishes the windowed app from headless by the absence of `--headless` in the command line, so it can never wipe a live session's locks), relaunches Chrome, and waits up to 10 seconds for the windowed process to return. `--no-launch` cleans up without relaunching.
3. **Driver self-cleanup** (committed): every script that spawns headless Chrome now kills its own instance and drops its throwaway profile on `exit`, `SIGINT`, `SIGTERM`, and `SIGHUP` — `capture-gallery.mjs`, `verify-prod-signin.mjs`, `verify-prod-matrix.mjs`, `tour-live.mjs` — and `capture-screenshots.sh` sweeps the gallery profile in an `EXIT` trap so even a Ctrl-C or CI timeout cannot leave instances behind. This also fixed a latent bug in `capture-gallery.mjs` where the bad-`--header` path called `chrome.kill()` before `chrome` was declared.
4. **Pre-push Chrome health check** (committed): the `.githooks/pre-push` hook now runs `chrome-revive.sh` (timeboxed to 15s) before any verifier, so a crashed Chrome is detected and revived automatically on every push instead of only after a manual hunt. It is best-effort: if revival fails, the verifiers still run and decide the push.

## Prevention

- `./scripts/chrome-revive.sh` is the one-command recovery for this class of failure.
- The four capture/verify drivers clean up after themselves, so headless Chrome instances and `/tmp` profiles can no longer accumulate across runs (the sweep at the time of writing found 20+ stale profile directories and 4 leaked instances).
- The pre-push hook revives Chrome before verification, so the next crash is caught at push time.
- For the underlying crash itself: this is a known Chrome-macOS crash family around remote-view animation fencing, fixed across Chrome versions — keep Chrome updated, and if it recurs, consider toggling hardware acceleration off in Settings → System. Restarting Chrome periodically clears the accumulated threads that made this process fragile after two days of uptime.

## Files

- `scripts/chrome-revive.sh` (new — one-command revive)
- `scripts/capture-screenshots.sh` (EXIT trap sweeps the gallery Chrome profile)
- `scripts/capture-gallery.mjs`, `scripts/verify-prod-signin.mjs`, `scripts/verify-prod-matrix.mjs`, `scripts/tour-live.mjs` (self-cleanup on exit and signals)
- `.githooks/pre-push` (Chrome health check before the verify suite)
