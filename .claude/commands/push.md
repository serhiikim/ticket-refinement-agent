Run type check and tests, then commit and push to main if everything passes.

Steps:
1. Run `npx tsc --noEmit` — fix any type errors before continuing
2. Run `npm test` — fix any failing tests before continuing
3. Show a git diff summary of what will be committed
4. Commit with a conventional commit message reflecting the actual changes
5. Push to origin main
