# Contributing

Install pinned workspace dependencies, run `pnpm schemas` after catalog/kit edits, and run `pnpm check` and `pnpm eval`. Dart changes require `flutter analyze` and `flutter test` in dart/engine_flutter. Native behavior changes require the independent apps and recorded device verification.

Use Conventional Commits and add a Changeset for public API changes. Keep model calls out of ordinary CI. New components need shared fixtures and matching semantics across the three renderers. Do not put gateway credentials or private model data in logs or fixtures.
