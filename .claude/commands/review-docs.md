Review whether CLAUDE.md and README.md are still accurate given recent code changes, and update any stale sections.

Steps:
1. Run `git diff HEAD~1..HEAD --stat` to see which files changed in the last commit. If there are no recent commits or the diff is empty, run `git diff --stat` to see uncommitted changes instead.
2. Run `git diff HEAD~1..HEAD -- src/` (or `git diff -- src/` for uncommitted) to understand what actually changed in source files.
3. Read `CLAUDE.md` and `README.md` in full.
4. For each changed source file, check whether it is mentioned in CLAUDE.md or README.md and whether those mentions are still accurate. Pay attention to:
   - File paths that no longer exist or have moved
   - Exported functions or classes that were renamed, removed, or added
   - Architecture descriptions that no longer match the code
   - Configuration variables or formats that changed
   - Any described behavior that was removed or altered
5. Update CLAUDE.md and README.md to fix any stale content. Only change what is actually wrong — do not rewrite sections that are still correct.
6. If both files are already accurate, say so explicitly and make no changes.
