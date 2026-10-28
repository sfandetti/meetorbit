# Contributing

Bug reports, integrations, alternate interfaces and enclosure improvements are welcome. Use an issue to discuss large changes before starting. Fork the repository, work on a branch and submit a focused pull request with the reason for the change and relevant test results.

Include Windows/Node versions, companion version, firmware/hardware revision, reproduction steps, and expected versus actual behavior. Keep experimental features labelled. Remove credentials and private information from screenshots and logs.

Never submit provider keys, Wi-Fi passwords, pairing tokens, recordings, browser profiles or runtime settings. Keep existing third-party notices and the license for the component you modify. See LICENSING.md.

Run `npm ci` and `npm test` in `software/` for companion changes. Unit tests are not a substitute for hardware validation; describe which checks you actually performed. Only reviewed changes become part of the official branch.
