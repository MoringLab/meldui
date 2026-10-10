# Release preparation

Packages remain private at 0.1.0. A proposed next preview is 0.2.0 once the owner, npm scope, pub.dev package name, repository and private security reporting contact are supplied. They are deliberately not invented. No registry or repository publication is part of this task.

Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm eval`, Expo lint/typecheck, both Flutter SDK/app analysis/tests, then `pnpm exec tsx scripts/package-check.ts`. The package check packs all twelve SDK packages, installs them into an independent consumer, exercises client rendering/custom catalog and runs npm publish dry-runs. It does not contact a publication endpoint. Expo and Flutter demo APKs must also pass the functional device flows. iOS simulator/build jobs exist but remain unexecuted on this Linux workstation.

For pub.dev, copy `dart/engine_flutter` into an isolated staging directory without build/.dart_tool, remove its private `publish_to: none` only in the copy, add the repository's LICENSE/NOTICE, initialize a local Git staging repository and run `flutter pub get`, `flutter analyze`, `flutter test`, `flutter pub publish --dry-run`. Preserve warnings about pinned dependencies/owner URLs; do not call publish on the working SDK. Dependency audit/third-party license evidence accompanies the dated verification report.

The Vite build includes a standalone Showcase and reservation consumer entry point. Host demo assets are synthetic Apache-2.0 files. Production deployment needs your server authentication, asset/URL resolver, privacy policy and business identity provider. The demo's loopback servers are not public multi-user services. Docker sandbox enablement additionally requires a matching local attestation and deployment-specific threat review.

Before publishing, resolve the dated report's generation/routing, semantic learning calibration, RN tail latency, iOS, accessibility and provider availability gates. Do not convert replay passes or a small dev/held-out probe into a claim of model task success.
