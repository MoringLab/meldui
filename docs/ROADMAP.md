# Roadmap and contribution opportunities

The first preview includes React, React Native/Expo and Flutter. Engine uses its own A2UI catalog rather than claiming support for arbitrary upstream catalogs. Publication requires finalized package names and ownership, a private reporting contact, release credentials and the verification gates in STATUS.md.

Good first contributions:

- Add labelled chart summaries for units and negative values, preserving the data-table alternative.
- Add host-provided image fixtures and accessibility assertions on all three platforms.
- Expand keyboard and screen-reader tests for accordion and error recovery.
- Add documentation examples showing AG-UI custom-event and existing-agent integrations.
- Add iOS simulator interaction automation to the existing macOS build jobs.

Before production release, improve model first-pass validity against the complete 30-prompt evaluation, validate TalkBack and enlarged text, and measure native frame performance on more devices. Semantic task quality must be reviewed separately from schema validity.

Desktop follows concrete embedding requirements. A free-form web sandbox is a later experimental package with its own threat model; catalog components will not gain arbitrary HTML, JavaScript or remote imports. See ADR 0003 for isolation limits and the deferred scope.
