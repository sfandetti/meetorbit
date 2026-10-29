# Orbit release handoff

Keep development changes separate from publication. Submit a frozen source snapshot and verification notes to the release maintainer for review.

Prepare a release handoff for your latest completed work in:
`docs/releases/`

Create `YYYY-MM-DD-update.md` (use the actual date; add a short suffix for multiple updates that day). Include:

1. **Build identity:** source root, version/build identifier, base commit and final commit if Git-managed, and whether there are uncommitted changes. If no commit exists, provide a SHA-256 source manifest and a frozen source snapshot. Do not invent a release number or Git tag.
2. **User-visible changes:** concise additions, fixes and removals. Explain the audio-crackle fix: cause, files changed, approach and limitations. Distinguish observations from hypotheses.
3. **Changed files:** exact relative paths, why each changed, and any migrations, settings changes, dependencies or wiring changes.
4. **Compatibility:** which PC companion, main firmware and optional speaker firmware must be used together; board/revision, Arduino/core/library versions, build flags and update order. State whether old versions remain compatible and whether any settings reset is required.
5. **Verification:** exact test/build commands, pass/fail totals and logs. List hardware checks actually performed, on which build, by whom and with what result. For audio, separate speaker playback, microphone capture, AI voice round trip, Bluetooth, alarm, ambient sounds and transitions. Never mark an unperformed check passed. Attribute Seth's listening feedback separately from automated tests.
6. **Known issues:** regressions, untested behavior and release blockers. State clearly whether you consider this a development snapshot or a tested release candidate, and why.
7. **Artifacts:** exact source snapshot, installer, main/speaker firmware and screenshot paths; file sizes and SHA-256 hashes. Say explicitly when an installer or firmware binary was not produced. Include required third-party notices; do not bundle dependencies without redistribution rights.
8. **Screenshots:** map filename to feature, orientation, theme and exact build. Flag stale/mislabeled images or captures containing personal/network data. Use `docs/screenshots/lying`, `standing` and `themes` for approved saved captures. Note which website descriptions should change.
9. **Upgrade and rollback:** tested update steps, preserved settings, previous known-good build/artifact, rollback procedure and recovery limitations. Do not promise reversibility you have not checked.
10. **Public release-note draft:** a short factual summary users can understand, with compatibility notes and known limitations. Avoid marketing claims, private paths, credentials or unsupported statements like “crackle fixed everywhere.”

Never include provider/API keys, passwords, Wi-Fi credentials, pairing tokens, account IDs, browser profiles, recordings or private chat content. Provide placeholders for configuration. No generated file may contain a real secret.

Do not run screenshot sweeps, taps, rotation/theme changes, audio tests, alarms or firmware uploads against the physical Orbit without Seth's explicit approval. If a capture job is approved, run it once, log its process, restore the original page/orientation/theme in a finally block and confirm the process exited. Do not leave jobs running or silently restart them.

When complete, give the release maintainer the handoff file path, exact frozen source revision/snapshot and artifact paths. The maintainer will review, run appropriate checks, preserve licenses, package downloads, update the site and publish. Do not publish independently.
