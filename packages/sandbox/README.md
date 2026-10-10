# @engine/sandbox

Experimental Node-only Docker provider for isolated generated HTML/app previews. It is separate from the declarative core and is disabled by default. Mobile targets display fallback text.

```sh
docker build -t engine-sandbox:1.58.2 packages/sandbox
pnpm sandbox:verify
# Enable only after the attestation matches this exact image, worker and policy:
ENGINE_SANDBOX_PROVIDER=docker pnpm --filter @engine/server start
```

The provider runs a separate Playwright Chromium process as `pwuser`, with Chromium's sandbox enabled, Docker network `none`, read-only filesystem, no capabilities, no-new-privileges, a 128MiB tmpfs, 512MiB memory/swap limit, 0.5 CPU, 96 pids and an external 8s watchdog. Concurrency is two. A narrow vendored seccomp profile permits Chromium user namespaces; neither privileged mode nor `--no-sandbox` is used.

Generated code runs only inside an opaque iframe. HTML mode disables scripts; app mode permits self-contained inline scripts under strict CSP. Navigation, popups, forms, storage, external frames, remote libraries, fonts and network are denied. The host bridge accepts bounded namespaced scalar data/theme, resize 200–800 and allowlisted action names. Credentials and model clients are absent. Source, events and output sizes are capped; stop/cancel removes the container.

The viewer receives a PNG and text alternative, not generated DOM. It replays at most 20 validated click/key events in a fresh isolated process, so it is a bounded reference preview rather than a persistent low-latency application runtime. Theme changes replay the source; there is no remote import or direct parent-DOM access. Hosts must authenticate any externally exposed endpoint, decide allowed actions, review generated content and conduct their own deployment threat assessment.

`verified()` requires the local corpus attestation at `artifacts/sandbox/attestation.json` to match a fingerprint of the image, trusted worker, seccomp and resource policy. An absent/stale attestation keeps the demo endpoint disabled. Passing eleven local attack cases is evidence for this configuration, not a production isolation certification or protection from unknown browser/kernel vulnerabilities. Apache-2.0; see NOTICE for the Microsoft seccomp profile license.
