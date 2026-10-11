# @engine/adapter-copilotkit

Optional MeldUI integration; install only in a CopilotKit host. Core does not depend on it.

`copilotKitTools(hostBridge)` returns descriptors for CopilotKit v2 `useFrontendTool`. Register the descriptors in stable host component/hook order. The handler validates input and obtains host confirmation through `HostBridge`. `copilotKitState()` exposes explicit public state read/write/subscribe functions.

`meldUIActivityRenderer(session, answerViewOptions)` returns a descriptor for the provider's `renderActivityMessages` list (`activityType: 'meldui'`). Its content is cumulative `{wire, complete?}`; mark complete only once the stream ends. Create a separate `AnswerSession` per activity and wrap the renderer with the host's `UIProvider`. Non-prefix replacement is rejected; use explicit revisioned artifact updates to edit existing answers.

`acceptCopilotKitActivity(session, activityId, cssHtmlJsContent, complete)` accepts Open Intelligent UI CSS/HTML/JS activity fields. Preview contains only CSS/HTML; JavaScript waits for `complete:true` and an opted-in `AppRuntimeProvider`. The host controls allowed resources and tools. No automatic remote imports or sandbox permission changes occur.

Apache-2.0; private preview. See [the shared contracts](../../docs/PHASE3.md) and the dated report for integration coverage. Descriptor behavior is tested; a deployed CopilotKit service is a separate consumer integration.
