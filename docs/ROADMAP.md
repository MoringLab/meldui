# Roadmap and contribution opportunities

The first preview includes React, React Native/Expo and Flutter. Engine uses its own A2UI catalog rather than claiming support for arbitrary upstream catalogs. Publication requires finalized package names and ownership, a private reporting contact, release credentials and the verification gates in STATUS.md.

Good first contributions:

- Add labelled chart summaries for units and negative values, preserving the data-table alternative.
- Add host-provided image fixtures and accessibility assertions on all three platforms.
- Expand keyboard and screen-reader tests for accordion and error recovery.
- Add documentation examples showing AG-UI custom-event and existing-agent integrations.
- Add iOS simulator interaction automation to the existing macOS build jobs.

Before production release, improve model first-pass validity against the complete 30-prompt evaluation, validate TalkBack and enlarged text, and measure native frame performance on more devices. Semantic task quality must be reviewed separately from schema validity.

Desktop follows concrete embedding requirements. An opt-in experimental Docker/Chromium web provider now supplies isolated previews; ordinary catalog components still cannot execute HTML/JS or import remote code. See ADR 0005 and the provider README. Production deployment threat review, persistent low-latency app interaction and native sandbox remain separate gates.
