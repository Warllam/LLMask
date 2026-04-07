# Contributing to LLMask

Thanks for your interest in contributing! LLMask is a privacy-focused tool, and every improvement helps keep sensitive data out of LLMs.

## Ways to Contribute

- Bug reports and feature requests via [GitHub Issues](https://github.com/Warllam/LLMask/issues)
- Code contributions via pull requests
- Documentation improvements
- Testing with different providers and setups

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/LLMask.git
   cd LLMask
   ```
3. **Install dependencies:**
   ```bash
   npm install
   cd dashboard && npm install && cd ..
   ```
4. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or: fix/short-description
   ```
5. **Copy `.env.example`** to `.env` and fill in credentials for the provider you're testing against.

## Development Workflow

```bash
npm run dev        # Start with hot reload
npm test           # Run tests
npm run typecheck  # TypeScript type check
npm run build      # Production build
```

Tests must pass and TypeScript must compile without errors before submitting a PR.

## Branch Naming

| Prefix | Use for |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code changes with no behavior change |
| `test/` | Adding or improving tests |

## Code Style

- TypeScript everywhere — no plain `.js` files in `src/`
- 2-space indentation
- Run `npm run typecheck` before pushing
- Keep functions small and focused
- Add tests for any new detection logic or masking behavior

## Pull Request Process

1. Open an issue first for non-trivial changes so we can discuss the approach
2. Keep PRs focused — one feature or fix per PR
3. Fill out the PR template completely
4. At least one passing CI check is required before merge
5. A maintainer will review within a few days

## Testing Requirements

- New masking patterns must include unit tests with both positive and negative examples
- Provider integrations must include at least one integration test (can be skipped in CI with an env flag)
- Dashboard changes should be visually tested in a browser

## Reporting Security Issues

**Do not open a public issue for security vulnerabilities.**
Please email the maintainers directly (see the repository contact) or use [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability).

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
