## [1.0.2](https://github.com/serhiikim/ticket-refinement-agent/compare/v1.0.1...v1.0.2) (2026-04-07)


### Bug Fixes

* retry analysis on any transient failure and suppress git stderr noise ([d060c75](https://github.com/serhiikim/ticket-refinement-agent/commit/d060c759ef1c1d456d3cf7e8987c25d9e38bf02e))

## [1.0.1](https://github.com/serhiikim/ticket-refinement-agent/compare/v1.0.0...v1.0.1) (2026-04-07)


### Bug Fixes

* detect Claude-committed changes and post accurate review comments ([550c404](https://github.com/serhiikim/ticket-refinement-agent/commit/550c404065168d3a8b781ecc920a43025ee65a88))

# 1.0.0 (2026-03-25)


### Bug Fixes

* increase coding pass timeout from 5 to 10 minutes ([f903465](https://github.com/serhiikim/ticket-refinement-agent/commit/f9034651973a484c154ebe860fc616e01b494e73))
* prevent infinite loop from agent's own comments triggering refinement_reply ([03f4218](https://github.com/serhiikim/ticket-refinement-agent/commit/03f4218409b02e75657f499ba0dd37562de9e3e7))
* retry PR creation on EPIPE after long coding pass ([1971b57](https://github.com/serhiikim/ticket-refinement-agent/commit/1971b579c31644d91db95ad80494b1ae6d7115d2))
* switch to stream-json output format for accurate token usage stats ([b5b61df](https://github.com/serhiikim/ticket-refinement-agent/commit/b5b61df92f157d617a6dd963c0a69efa98e0bc77))
* type errors, clean PR body, add /push command with typecheck ([f250dcb](https://github.com/serhiikim/ticket-refinement-agent/commit/f250dcbdff80d7189f1cff4e2c59ef1f3e622d73))
* use --force-with-lease when pushing ai branches ([9c18c2e](https://github.com/serhiikim/ticket-refinement-agent/commit/9c18c2e446519e7af33032c9a8e629be73a65762))
* use async writeFile in sessions.ts to avoid blocking event loop ([aa1fb31](https://github.com/serhiikim/ticket-refinement-agent/commit/aa1fb31212d436a00a95b56d32a1a17259bfece6))


### Features

* add GitHub App configuration and new AI labels, remove GITHUB_TOKEN from .env.example ([2e5aab5](https://github.com/serhiikim/ticket-refinement-agent/commit/2e5aab5469d2521ae10868f6104a13f35bd16cee))
* Add Telegram notifications for deployment success and failure. ([b3c509c](https://github.com/serhiikim/ticket-refinement-agent/commit/b3c509c4aa652202c865e5af0061424fede735b3))
* GitHub App authentication replaces static PAT ([37a11da](https://github.com/serhiikim/ticket-refinement-agent/commit/37a11dab90c67057299e04de23d8b114cdea0b59))
* human review gate + Claude session resumption ([aba2069](https://github.com/serhiikim/ticket-refinement-agent/commit/aba206905229ecce088606736fbb564682ee3b3d))
* improve error logging in `withRepoLock` and update the deployment message for the AI Ticket Agent. ([1588452](https://github.com/serhiikim/ticket-refinement-agent/commit/158845213143d8f7388b56401e4d28f24969f08e))
* Introduce `ai-pr-prepared` workflow state, update `createDraftPr` return type, and clarify session clearing on issue closure. ([62a939d](https://github.com/serhiikim/ticket-refinement-agent/commit/62a939d5a57a5e6b777dfef5800914c716037ae2))
* introduce GitHub Actions for VPS deployment and add comprehensive Claude integration documentation. ([7ee0351](https://github.com/serhiikim/ticket-refinement-agent/commit/7ee0351013bcb64a503e2a0cc24091e32526fb7a))
* PR review loop with ai-pr-prepared state and issue_closed session cleanup ([a4c8f3e](https://github.com/serhiikim/ticket-refinement-agent/commit/a4c8f3e81aa60026af9960d63ffc8766f5c60b21))
* Remove `openDraftPrFromBranch` function and enhance `claudeRunner` to parse and log detailed Claude usage statistics. ([c5dde80](https://github.com/serhiikim/ticket-refinement-agent/commit/c5dde803384613217d7e305f65e5e71b29a44bce))
* support base-branch override for issues on unmerged branches ([6acdc07](https://github.com/serhiikim/ticket-refinement-agent/commit/6acdc07cf87bdaddfd1a4ab0a0749db3b91483cd))


### Reverts

* back to --output-format json, remove usage stats logging ([0d894e5](https://github.com/serhiikim/ticket-refinement-agent/commit/0d894e57691d611ac61d6ea97b0b2078aff0dcd1))
