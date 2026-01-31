Create a pull request with auto-generated description.

## Steps
1. Verify working directory is clean (all changes committed)
2. Check current branch is not main
3. Push branch to remote if needed
4. Analyze all commits since branching from main
5. Generate PR title and structured description
6. Create PR using GitHub CLI

## Prerequisites
- GitHub CLI (`gh`) installed and authenticated
- Clean working directory (all changes committed)
- Branch is not `main`

## PR Format
- Title: Conventional Commit format (`type(scope): subject`)
- Body: Summary bullets, list of changes, test plan
- Base branch: `main`
