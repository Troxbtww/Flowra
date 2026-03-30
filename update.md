## Plan: Overlay-Hotkey Live Session Flow

Implement the requested live workflow by adding a lightweight session state machine around existing Live Assist plumbing: app starts hidden/minimized, recording auto-starts in live mode, Ctrl+U toggles quick overlay analysis panel visibility while analyzing the latest "Them" utterance, Ctrl+Y pauses/resumes capture in the same timeline, and Shift+Ctrl+Y ends session, restores main window, runs analysis, and lands on Summary.

**Steps**
1. Phase 1 - Define behavior contracts and state model
1. Add explicit live session states in renderer (idle, recording, paused, ending) and map each shortcut to one state transition to remove ambiguous toggle behavior; depends on no prior steps.
2. Define Ctrl+U behavior contract as dual action: when overlay hidden -> show overlay and trigger quick analysis, when overlay visible -> hide overlay and clear quick panel; depends on step 1.
3. Define end-session contract for Shift+Ctrl+Y: stop capture, persist backup, show normal window, run existing analysis pipeline, route to Summary; depends on step 1.
4. Phase 2 - Main process shortcut and startup lifecycle
1. Update global shortcut registrations so Ctrl+Y sends pause/resume event, Ctrl+U sends overlay quick-read toggle event, and Shift+Ctrl+Y sends end-session event; depends on Phase 1.
2. Change startup behavior to hidden/minimized tray-first launch (no full window flash) while preserving tray recovery path; can run parallel with Phase 3 step 1 but must complete before verification.
3. Ensure overlay sync IPC remains single source of truth whenever visibility/mode changes (startup, Ctrl+U toggle, end session).
4. Phase 3 - Preload + typing surface updates
1. Add/rename preload event channels and APIs for pause/resume and Ctrl+U overlay toggle semantics, then mirror in window type declarations; parallel with Phase 2 step 2.
2. Keep backward compatibility during transition by preserving existing handlers until renderer migration is complete; depends on step 1.
3. Remove legacy hotkey channel names only after renderer is switched and validated; depends on Phase 4.
4. Phase 4 - Renderer live session behavior
1. Refactor Live Assist hotkey handlers to use explicit actions: Ctrl+Y pauses/resumes current session state instead of stop/start; depends on Phases 1 and 3.
2. Implement pause/resume internals in controller/pipeline with same-session continuity (no transcript reset), including guard against duplicate start/stop calls; depends on step 1.
3. Implement Ctrl+U toggle behavior in LiveAssistView: first press shows overlay and runs quick analysis from latest Them utterance, second press hides overlay and clears quick insight card; depends on step 1.
4. Update overlay UI text/status indicator to show recording vs paused state clearly in compact mode.
5. Keep existing auto-start recording path on entering live mode, but align status text and session state initialization with new pause model.
6. Phase 5 - End-session + analysis handoff
1. Wire Shift+Ctrl+Y path to call shared end-session routine used by button flow, then normalize window to full mode before analysis navigation; depends on Phases 2 and 4.
2. Reuse existing App-level handleAnalyzeFromLive path to avoid duplicate analysis logic, ensuring destination is Summary on success and live error surface on failure.
3. Confirm transcript backup + live session backup still occur before analysis and that errors remain non-fatal where intended.
4. Phase 6 - Cleanup and hardening
1. Remove stale shortcut labels/help text still referencing Ctrl+Shift+F and update overlay instruction strings to Ctrl+U / Ctrl+Y / Shift+Ctrl+Y.
2. Add defensive cleanup for hotkey registration/unregistration on view unmount and app quit to prevent orphan listeners.
3. Verify tray actions still recover app when hidden and do not desync renderer overlay state.

**Relevant files**
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/main/index.ts - Startup visibility, global shortcut mapping, overlay/full-window transitions, tray recovery behavior.
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/preload/index.ts - Renderer-exposed IPC methods/listeners for hotkey and overlay events.
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/renderer/src/lib/types.ts - Window API typing changes for any new/renamed IPC events and session-state-related payloads.
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/renderer/src/views/LiveAssistView.tsx - Ctrl+U toggle behavior, pause indicator, session state transitions, end-session trigger unification.
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/renderer/src/lib/live-assist/controller.ts - Pause/resume implementation and same-session timeline continuity.
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/renderer/src/lib/audio/capture.ts - Underlying audio pipeline pause/resume mechanics and resource management.
- c:/Users/majds/Downloads/Flowra (5)/Flowra/src/renderer/src/App.tsx - End-session analysis route to Summary and overlay sync behavior.

**Verification**
1. Launch app and confirm it starts hidden/minimized with tray available and no full window flash.
2. Enter live session and confirm recording auto-starts without manual action.
3. Press Ctrl+U once: overlay appears and quick analysis card populates from latest Them utterance (or expected empty-state message).
4. Press Ctrl+U again: overlay hides and quick panel state is cleared.
5. Press Ctrl+Y while recording: status changes to paused in overlay and transcript stops growing.
6. Press Ctrl+Y again: status returns to recording and transcript resumes in same timeline.
7. Press Shift+Ctrl+Y: session ends, main window restores, analysis runs, and app lands directly on Summary.
8. Validate hotkey/tray help text reflects new bindings and no Ctrl+Shift+F references remain.
9. Run project checks (typecheck/lint/test as available) and verify no new TypeScript errors in touched files.

**Decisions**
- Startup visibility: app starts hidden/minimized; Ctrl+U toggles overlay show/hide.
- Auto recording: starts automatically on app launch into Live Assist.
- Pause semantics: pause/resume must keep same session timeline and accumulated transcript.
- End-session destination: go directly to Summary after Shift+Ctrl+Y flow.
- Included scope: shortcut behavior, startup mode, overlay status indication, end-session handoff.
- Excluded scope: redesigning analysis algorithms, changing transcription provider logic, or schema migrations.

**Further Considerations**
1. Prefer true pause/resume in audio pipeline over stop/restart fallback to preserve continuity metrics and avoid permission churn.
2. Keep tray menu labels aligned with new hotkeys to reduce operator confusion during live use.
3. Consider introducing a single source enum for shortcut labels to avoid future text drift across UI and tray.