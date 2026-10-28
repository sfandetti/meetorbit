# Development setup

## Windows companion

Use a current Node.js LTS installation. Run `npm ci` and `npm start` from `software/`. The current companion opens on port 8910; do not run it over another installed companion using the same port. This repository does not start or alter your existing installed Orbit automatically.

API credentials belong in local console settings, never source. OpenAI, Anthropic and DeepSeek API access is separate from consumer chat subscriptions. Cursor integration requires the locally installed CLI. Codex pairing is its own integration.

## Firmware

Source is in `software/firmware/OrbitDevice` and `software/firmware/OrbitSpeaker`. The build helper is `software/tools/build-firmware.mjs`. Arduino CLI, the ESP32 core and the libraries included by the sketches must be installed separately. The helper accepts `ARDUINO_CLI`, `ARDUINO_CONFIG` and `ARDUINO_LIBRARIES` overrides; its default sibling `work/` layout belongs to the development setup and is not included.

The helper uses `esp32:esp32:esp32:FlashSize=4M,PartitionScheme=min_spiffs` for dual update slots. Do not substitute a no-OTA partition layout. A reproducible pinned toolchain, dependency list and matched firmware binaries still need release validation. Do not flash an unverified target merely because the source compiles.

## CAD

Parametric Python sources under `hardware/CAD` use CadQuery/OpenCascade; rendering helpers also require Blender or their declared imports. Generated production files are not implied to be verified by including the scripts. Capsule scripts expect a hardware output root containing CAD, STL and Print folders. Preserve revision notes and fit-test labels.

## Tests

From `software/`, run `npm test`. Unit tests and fixture checks are separate from real hardware, clean-account setup and installer checks.

## Optional recording

FFmpeg is not bundled. Review its applicable distribution terms and install a compatible dependency before testing recording. Generated recordings are private runtime data and excluded from version control.

## AI engines and Hue

Save provider keys in the console; the ENGINE screen lists configured engines. Claude/DeepSeek/Cursor voice uses OpenAI speech services alongside the selected engine. Hue room control requires pairing a compatible Hue bridge in the PC console. Music Link uses audio/beat data from the visualizer; STOP restores the remembered settings.
