# Orbit â€” source review snapshot

Orbit connects an ESP32 touch display, microphone, speaker and LED rings to a Windows PC.
This is development source prepared for open-source publication on 28 October 2026. It is not a
tested public release or a signed installer. The original development folder is unchanged.

## Run the current companion

Install Node.js, open this folder in a terminal, then run:

```powershell
npm ci
npm start
```

Open http://127.0.0.1:8910 in your browser. Configure provider credentials in the console,
not in source files. The Windows companion requires an awake PC; AI APIs require their
own accounts and billing. Device functions require compatible firmware and Wi-Fi pairing.
The existing unit suite passed 119 tests during repository preparation. Hardware and clean-install validation remain separate checks.

## Source map

- `main.mjs`: consolidated Node companion entry point.
- `console/`: current companion interface.
- `ai-desk.mjs`: OpenAI, Anthropic, DeepSeek and Cursor CLI Ask connections.
- `voice-relay.mjs`, `voice-proxy.mjs`: voice transport and provider connection.
- `device-link.mjs`, `device-feed.mjs`: device communication and data.
- `privacy.mjs`: selected-folder and browser data cleanup.
- `pc-stats.mjs`: Windows PC telemetry.
- `sentry.mjs`, `shortcuts.mjs`: camera and command tools.
- `firmware/OrbitDevice/`, `firmware/OrbitSpeaker/`: firmware sources.
- `tools/`: firmware build entry point; Arduino toolchain and libraries are separate dependencies.
- `legacy-source/`: earlier Python companion retained as development reference.
- Root simulator files are retained as reference; they are not proof every feature is on hardware.

## Tests

`npm test` runs the project test list. These use mocks and fixtures; real hardware testing,
installer validation and matching firmware are separate release checks.

## Contributing and licenses

See ../CONTRIBUTING.md and ../LICENSING.md. Software is MIT licensed; the bundled font notices remain applicable.
