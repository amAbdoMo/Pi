# Third-party notices

## DeepSeek Harness

Pi Harness contains source-derived visual structure, design tokens, layout geometry, and interaction patterns adapted from DeepSeek Harness.

- Upstream: <https://github.com/deepseek-ai/deepseek-harness>
- Version/tag: `dsh-v0.1.1-rc.2`
- Pinned revision: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- License: MIT
- Copyright: Copyright (c) 2026 DeepSeek
- License copy: [`browser/licenses/deepseek-harness-MIT.txt`](browser/licenses/deepseek-harness-MIT.txt)

The adapted browser shell primarily derives from the upstream `ui-theme`, `ui-layout`, `ui-sidebar`, `ui-conversation`, `ui-model-selection`, and `ui-workspace` source packages at that revision. This includes adapted versions of the `StateDot` pixel-chase activity mark and `TurnStatus` “Deep diving...” shimmer. Pi Workbench changes the product identity, DOM implementation, runtime state, transport, security boundary, and user-facing behavior to use Pi RPC and Pi extensions. DeepSeek's agent runtime, Cordis boot profile, dynamic JavaScript evaluator, and compiled web distribution are not included.

No upstream third-party font or compiled dependency bundle is redistributed by the current source-derived client. If later revisions add upstream assets or dependencies, their notices must be added here before release.
