# Contributing to Ticket Refinement Agent

First off, thank you for considering contributing to the Ticket Refinement Agent! This project aims to seamlessly connect AI agents with project management tools, and community contributions are what make it great.

This document outlines the development workflow, architectural conventions, and the process for submitting Pull Requests.

---

## 🏗️ Architecture (Read This First!)

This project strictly adheres to the **Ports and Adapters (Hexagonal) Architecture**.

The core agent orchestrator lives in `src/index.ts` and runs the AI pipelines (`claudeRunner.ts`, `contextBuilder.ts`, etc.). **The core pipeline is completely platform-agnostic.** It does not know if it is talking to GitHub, Jira, GitLab, or Asana.

### Adding New Integrations (e.g., Jira, Linear, Asana)
If you want to add support for a new Project Management or Source Control tool, **do not modify `src/index.ts`**. Instead:

1. Look in `src/types.ts` at the interfaces (`IWebhookAdapter`, `ITicketProvider`, `ISourceControlProvider`).
2. Create a new provider inside `src/adapters/` (e.g., `src/adapters/JiraTicketProvider.ts`) that implements the relevant interface.
3. Update `src/config.ts` if your integration requires new environment variables (e.g., `JIRA_API_TOKEN`).

---

## 💻 Local Development Setup

To test changes locally, you'll need Node.js 18+ and `claude-code` installed globally.

1. **Clone & Install Dependencies**
   ```bash
   git clone https://github.com/serhiikim/ticket-refinement-agent.git
   cd ticket-refinement-agent
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   Fill in your GitHub App credentials or PATs. You'll need an active GitHub App or Personal Access Token to run end-to-end tests against real issues.

3. **Start the Development Server**
   ```bash
   npm run dev
   ```
   This will start the Hono server on `http://localhost:3008` with hot-reloading enabled via `tsx watch`.

---

## 🧪 Testing

We use [Vitest](https://vitest.dev/) for unit testing. **All new adapters or complex logic must include tests.**

- Run the test suite:
  ```bash
  npm test
  ```
- Make sure TypeScript compiles cleanly without errors:
  ```bash
  npx tsc --noEmit
  ```

---

## 📝 Pull Request Guidelines & Versioning

This repository uses **[semantic-release](https://semantic-release.gitbook.io/)** to automate version bumping and GitHub releases entirely in CI. Because of this, **all commits and PR titles must strictly follow the [Conventional Commits specification](https://www.conventionalcommits.org/)**.

- Use `feat:` for new features (triggers a `MINOR` release step: e.g., 1.0.0 → 1.1.0).
- Use `fix:` for bug fixes (triggers a `PATCH` release step: e.g., 1.0.0 → 1.0.1).
- Use `chore:`, `docs:`, `test:`, `refactor:` etc., for changes that do not require an immediate version bump.

1. **Fork the repo** and create your branch from `main`.
2. **If you've added code that should be tested, add tests.** (Check out `src/adapters/GitHubWebhookAdapter.test.ts` for examples).
3. **Ensure the test suite passes.** (`npm test`)
4. **Keep PRs small and focused.** If you are adding a massive new feature, please open an Issue to discuss the architecture design first!
5. **Add a descriptive title and body.** Explain *what* you changed and *why*.

### Submitting a PR
When you are ready, push your branch to your fork and open a Pull Request against the `main` branch. 

Once again, thank you for contributing!
