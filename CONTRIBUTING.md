# Contributing

Thanks for contributing to `youtube-transcript-ts`. This guide covers the setup,
the commit convention, and the gate your change must pass before it merges.

## Prerequisites

| Tool    | Version |
| ------- | ------- |
| Node.js | `>=18`  |
| pnpm    | `>=8`   |

This project uses `pnpm`. Use `corepack enable` (bundled with Node) to get a
pinned `pnpm`, or install it directly.

## Setup

```bash
git clone https://github.com/wickes1/youtube-transcript-ts.git
cd youtube-transcript-ts
pnpm install
```

`pnpm install` runs `prepare`, which sets up the Husky pre-commit hook. The hook
runs `lint-staged` (ESLint `--fix` + Prettier) on staged `.ts` files.

## Commit convention

Commits are validated by [commitlint](https://commitlint.js.org/) against
[Conventional Commits](https://www.conventionalcommits.org/). A commit that does
not match is rejected, so format the subject as `type(scope): summary`.

```
feat(api): add options-object form to fetchTranscript
fix(esm): emit extensioned specifiers in the dual build
docs: document the Invidious trust boundary
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
Append `!` after the type or add a `BREAKING CHANGE:` footer for breaking changes.

## The gate

Run these locally before opening a pull request. CI runs the same checks.

```bash
pnpm check   # lint + format:check + typecheck + test
pnpm build   # tsup dual ESM/CJS build
pnpm smoke   # import the built dist and construct the API under real Node ESM
```

`pnpm check` must be green, `pnpm build` must succeed, and `pnpm smoke` must exit
`0`. The smoke step is what catches a build that compiles but cannot be imported
or constructed by an ESM consumer, so do not skip it.

## Pull requests

- Add or update tests for the behavior you change.
- Note any user-facing changes in the PR description (release notes are published via GitHub Releases).
- Keep the diff focused on one concern.

See the pull request template for the full checklist.
