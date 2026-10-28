//! Warsha Git — Git + GitHub integration: repos, branches, issues, PRs, checks.
//!
//! Git operations shell out to the `git` CLI through [`std::process::Command`],
//! so the crate compiles on stable Rust without native bindings. GitHub
//! operations are plain REST calls issued with `reqwest`.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use warsha_core::RunId;

/// Maximum number of characters kept when deriving a branch slug.
const MAX_SLUG_LEN: usize = 60;

/// Slug used when a title contains no usable ASCII alphanumeric characters.
const FALLBACK_SLUG: &str = "warsha-work";

/// Base URL of the GitHub REST API.
const GITHUB_API_BASE: &str = "https://api.github.com";

/// `User-Agent` sent with every GitHub request; GitHub rejects requests without it.
const USER_AGENT: &str = "warsha";

/// `Accept` header required by the GitHub REST API.
const GITHUB_ACCEPT: &str = "application/vnd.github+json";

/// Errors produced by Git and GitHub operations.
#[derive(Error, Debug)]
pub enum GitError {
    /// The `git` CLI could not be run, failed, or produced unusable output.
    #[error("Git error: {0}")]
    Git(String),
    /// A GitHub REST call failed or returned an unusable response.
    #[error("GitHub error: {0}")]
    GitHub(String),
    /// No repository exists at the requested path.
    #[error("Repository not found: {0}")]
    RepoNotFound(String),
    /// The requested branch does not exist.
    #[error("Branch not found: {0}")]
    BranchNotFound(String),
    /// The requested pull request does not exist.
    #[error("PR not found: {0}")]
    PRNotFound(u64),
    /// A GitHub token is required but was not provided.
    #[error("Authentication required")]
    AuthRequired,
    /// Local filesystem failure.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// Anything that does not fit the variants above.
    #[error("Other: {0}")]
    Other(String),
}

/// Result alias used throughout this crate.
pub type Result<T> = std::result::Result<T, GitError>;

/// Reject ref/remote arguments that `git` would read as options, or that cannot
/// be a valid name, so shelling out to the CLI stays predictable.
fn validate_ref_arg(kind: &str, name: &str) -> Result<()> {
    let invalid = name.is_empty()
        || name.starts_with('-')
        || name.contains("..")
        || name.contains(char::is_whitespace);
    if invalid {
        return Err(GitError::Other(format!("invalid {kind}: {name}")));
    }
    Ok(())
}

/// Normalise a free-form title into a branch-name-friendly slug.
///
/// ASCII letters are lowercased, every run of other characters collapses into a
/// single `-`, and the result is capped at [`MAX_SLUG_LEN`] characters. Titles
/// without ASCII alphanumerics (for example Arabic-only titles) yield
/// [`FALLBACK_SLUG`].
pub fn slugify_branch_name(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }

    let limited: String = slug
        .trim_end_matches('-')
        .chars()
        .take(MAX_SLUG_LEN)
        .collect();
    let limited = limited.trim_end_matches('-');
    if limited.is_empty() {
        FALLBACK_SLUG.to_string()
    } else {
        limited.to_string()
    }
}

/// Branch name used for the work branch of a pipeline run.
pub fn branch_name_for_run(run_id: RunId) -> String {
    format!("warsha/{run_id}")
}

/// A local Git repository driven through the `git` CLI.
pub struct GitRepo {
    path: PathBuf,
}

impl GitRepo {
    /// Open the repository at `path`, verifying that `git` can address it.
    pub fn open(path: &Path) -> Result<Self> {
        let repo = Self {
            path: path.to_path_buf(),
        };
        repo.run(&["rev-parse", "--git-dir"])?;
        Ok(repo)
    }

    /// Create the directory if needed and initialise a repository at `path`.
    pub fn init(path: &Path) -> Result<Self> {
        std::fs::create_dir_all(path)?;
        let repo = Self {
            path: path.to_path_buf(),
        };
        repo.run(&["init"])?;
        Ok(repo)
    }

    /// Path this instance was created with.
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Paths with uncommitted changes, as reported by `git status --porcelain`.
    pub fn status(&self) -> Result<Vec<String>> {
        let output = self.run(&["status", "--porcelain"])?;
        let mut entries = Vec::new();
        for line in output.lines() {
            let Some(rest) = line.get(3..) else {
                continue;
            };
            let path = rest.rsplit_once(" -> ").map_or(rest, |(_, target)| target);
            let path = path.trim().trim_matches('"');
            if !path.is_empty() {
                entries.push(path.to_string());
            }
        }
        Ok(entries)
    }

    /// Create `name` pointing at whatever `base` resolves to.
    pub fn create_branch(&self, name: &str, base: &str) -> Result<()> {
        validate_ref_arg("branch name", name)?;
        validate_ref_arg("base revision", base)?;
        self.run(&["branch", name, base])?;
        Ok(())
    }

    /// Check out an existing branch.
    pub fn checkout(&self, branch: &str) -> Result<()> {
        validate_ref_arg("branch name", branch)?;
        self.run(&["checkout", branch])?;
        Ok(())
    }

    /// Stage every change and commit it, returning the new commit id.
    pub fn commit(&self, message: &str) -> Result<String> {
        if message.trim().is_empty() {
            return Err(GitError::Other("empty commit message".to_string()));
        }
        self.run(&["add", "-A"])?;
        self.run(&[
            "-c",
            "user.name=Warsha",
            "-c",
            "user.email=warsha@local",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            message,
        ])?;
        let head = self.run(&["rev-parse", "HEAD"])?;
        Ok(head.trim().to_string())
    }

    /// Push `branch` to `remote`.
    pub fn push(&self, remote: &str, branch: &str) -> Result<()> {
        validate_ref_arg("remote name", remote)?;
        validate_ref_arg("branch name", branch)?;
        self.run(&["push", remote, branch])?;
        Ok(())
    }

    /// Run `git` inside this repository and return its raw stdout.
    fn run(&self, args: &[&str]) -> Result<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(self.path.as_os_str())
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| GitError::Git(format!("could not run git: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let detail = if stderr.is_empty() {
                output.status.to_string()
            } else {
                stderr
            };
            let command = args.join(" ");
            return Err(GitError::Git(format!("git {command} failed: {detail}")));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

/// Merge strategy accepted by the GitHub merge endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum MergeMethod {
    /// Create a merge commit.
    #[default]
    Merge,
    /// Squash every commit into one.
    Squash,
    /// Rebase the commits onto the base branch.
    Rebase,
}

impl MergeMethod {
    /// Value expected by the GitHub REST API.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Squash => "squash",
            Self::Rebase => "rebase",
        }
    }
}

impl std::fmt::Display for MergeMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Subset of the GitHub repository payload Warsha relies on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repository {
    /// Numeric repository id.
    #[serde(default)]
    pub id: u64,
    /// Repository name without its owner.
    #[serde(default)]
    pub name: String,
    /// `owner/name` as reported by GitHub.
    #[serde(default)]
    pub full_name: String,
    /// Repository description.
    #[serde(default)]
    pub description: Option<String>,
    /// Whether the repository is private.
    #[serde(default)]
    pub private: bool,
    /// Browser URL of the repository.
    #[serde(default)]
    pub html_url: String,
    /// Default branch name.
    #[serde(default)]
    pub default_branch: Option<String>,
}

/// Subset of the GitHub issue payload Warsha relies on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    /// Numeric issue id.
    #[serde(default)]
    pub id: u64,
    /// Per-repository issue number.
    #[serde(default)]
    pub number: u64,
    /// Issue title.
    #[serde(default)]
    pub title: String,
    /// Issue body, when one was given.
    #[serde(default)]
    pub body: Option<String>,
    /// Open/closed state.
    #[serde(default)]
    pub state: String,
    /// Browser URL of the issue.
    #[serde(default)]
    pub html_url: String,
}

/// Subset of the GitHub pull request payload Warsha relies on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    /// Numeric pull request id.
    #[serde(default)]
    pub id: u64,
    /// Per-repository pull request number.
    #[serde(default)]
    pub number: u64,
    /// Pull request title.
    #[serde(default)]
    pub title: String,
    /// Pull request body, when one was given.
    #[serde(default)]
    pub body: Option<String>,
    /// Open/closed/merged state.
    #[serde(default)]
    pub state: String,
    /// Browser URL of the pull request.
    #[serde(default)]
    pub html_url: String,
}

/// One check run attached to a commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckRun {
    /// Numeric check run id.
    #[serde(default)]
    pub id: u64,
    /// Name of the check.
    #[serde(default)]
    pub name: String,
    /// Current status, for example `completed`.
    #[serde(default)]
    pub status: String,
    /// Conclusion once the check completed.
    #[serde(default)]
    pub conclusion: Option<String>,
    /// Browser URL of the check run.
    #[serde(default)]
    pub html_url: Option<String>,
}

/// Pull request payload as needed to locate its check runs.
#[derive(Debug, Deserialize)]
struct PrDetail {
    head: Option<PrHeadRef>,
}

/// Head ref of a pull request.
#[derive(Debug, Deserialize)]
struct PrHeadRef {
    #[serde(default)]
    sha: String,
}

/// Wrapper returned by the check-runs endpoint.
#[derive(Debug, Deserialize)]
struct CheckRunsPage {
    #[serde(default)]
    check_runs: Vec<CheckRun>,
}

/// Wrapper returned by the pull request merge endpoint.
#[derive(Debug, Deserialize)]
struct MergeOutcome {
    #[serde(default)]
    merged: bool,
    #[serde(default)]
    message: String,
}

/// Body of a `POST /user/repos` request.
#[derive(Debug, Serialize)]
struct CreateRepoBody<'a> {
    name: &'a str,
    description: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    template_owner: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    template_repo: Option<&'a str>,
}

/// Body of a `POST /repos/{owner}/{repo}/issues` request.
#[derive(Debug, Serialize)]
struct CreateIssueBody<'a> {
    title: &'a str,
    body: &'a str,
}

/// Body of a `POST /repos/{owner}/{repo}/pulls` request.
#[derive(Debug, Serialize)]
struct CreatePrBody<'a> {
    title: &'a str,
    body: &'a str,
    head: &'a str,
    base: &'a str,
}

/// Body of a `PUT /repos/{owner}/{repo}/pulls/{number}/merge` request.
#[derive(Debug, Serialize)]
struct MergeBody {
    merge_method: &'static str,
}

/// Minimal GitHub REST client covering the operations Warsha needs.
pub struct GitHubClient {
    client: reqwest::Client,
    token: String,
    api_base: String,
}

impl GitHubClient {
    /// Build a client for the given personal access token.
    pub fn new(token: &str) -> Result<Self> {
        if token.trim().is_empty() {
            return Err(GitError::AuthRequired);
        }
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| GitError::GitHub(format!("could not build HTTP client: {e}")))?;
        Ok(Self {
            client,
            token: token.to_string(),
            api_base: GITHUB_API_BASE.to_string(),
        })
    }

    /// Point the client at another REST base, for example GitHub Enterprise.
    pub fn with_api_base(mut self, api_base: &str) -> Self {
        self.api_base = api_base.trim_end_matches('/').to_string();
        self
    }

    /// Create a repository owned by the authenticated account.
    ///
    /// `template` is an `owner/repo` reference; when it is given the repository
    /// is generated from that template.
    pub async fn create_repo(
        &self,
        name: &str,
        description: &str,
        template: Option<&str>,
    ) -> Result<Repository> {
        let (template_owner, template_repo) = split_template(template);
        let payload = CreateRepoBody {
            name,
            description,
            template_owner,
            template_repo,
        };
        let url = self.endpoint("user/repos");
        let request = self.authorized(self.client.post(url).json(&payload));
        self.execute(request).await
    }

    /// Open an issue.
    pub async fn create_issue(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
    ) -> Result<Issue> {
        let url = self.repo_endpoint(owner, repo, "issues");
        let payload = CreateIssueBody { title, body };
        let request = self.authorized(self.client.post(url).json(&payload));
        self.execute(request).await
    }

    /// Open a pull request from `head` into `base`.
    pub async fn create_pr(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
        head: &str,
        base: &str,
    ) -> Result<PullRequest> {
        let url = self.repo_endpoint(owner, repo, "pulls");
        let payload = CreatePrBody {
            title,
            body,
            head,
            base,
        };
        let request = self.authorized(self.client.post(url).json(&payload));
        self.execute(request).await
    }

    /// Fetch a single pull request.
    pub async fn get_pr(&self, owner: &str, repo: &str, pr_number: u64) -> Result<PullRequest> {
        let reference = format!("pulls/{pr_number}");
        let url = self.repo_endpoint(owner, repo, &reference);
        let request = self.authorized(self.client.get(url));
        self.execute(request).await
    }

    /// Check runs reported for the head commit of a pull request.
    pub async fn get_pr_checks(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<CheckRun>> {
        let reference = format!("pulls/{pr_number}");
        let pr_url = self.repo_endpoint(owner, repo, &reference);
        let request = self.authorized(self.client.get(pr_url));
        let detail: PrDetail = self.execute(request).await?;

        let head = match detail.head {
            Some(head) if !head.sha.is_empty() => head,
            _ => return Err(GitError::PRNotFound(pr_number)),
        };

        let sha = head.sha.as_str();
        let reference = format!("commits/{sha}/check-runs");
        let checks_url = self.repo_endpoint(owner, repo, &reference);
        let request = self.authorized(self.client.get(checks_url));
        let page: CheckRunsPage = self.execute(request).await?;
        Ok(page.check_runs)
    }

    /// Merge a pull request and return its refreshed state.
    pub async fn merge_pr(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
        method: MergeMethod,
    ) -> Result<PullRequest> {
        let reference = format!("pulls/{pr_number}/merge");
        let url = self.repo_endpoint(owner, repo, &reference);
        let payload = MergeBody {
            merge_method: method.as_str(),
        };
        let request = self.authorized(self.client.put(url).json(&payload));
        let outcome: MergeOutcome = self.execute(request).await?;

        if !outcome.merged {
            let message = if outcome.message.is_empty() {
                "GitHub did not accept the merge".to_string()
            } else {
                outcome.message
            };
            return Err(GitError::GitHub(message));
        }

        self.get_pr(owner, repo, pr_number).await
    }

    /// Build a URL below the API base.
    fn endpoint(&self, suffix: &str) -> String {
        let base = self.api_base.trim_end_matches('/');
        format!("{base}/{suffix}")
    }

    /// Build a URL for a repository-scoped endpoint.
    fn repo_endpoint(&self, owner: &str, repo: &str, suffix: &str) -> String {
        let base = self.api_base.trim_end_matches('/');
        if suffix.is_empty() {
            format!("{base}/repos/{owner}/{repo}")
        } else {
            format!("{base}/repos/{owner}/{repo}/{suffix}")
        }
    }

    /// Attach the headers GitHub requires to an outgoing request.
    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .bearer_auth(self.token.as_str())
            .header("Accept", GITHUB_ACCEPT)
            .header("User-Agent", USER_AGENT)
    }

    /// Send a request and decode its JSON body.
    async fn execute<T>(&self, request: reqwest::RequestBuilder) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let response = request
            .send()
            .await
            .map_err(|e| GitError::GitHub(format!("GitHub request failed: {e}")))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| GitError::GitHub(format!("could not read GitHub response: {e}")))?;

        if !status.is_success() {
            let code = status.as_u16();
            let detail = truncate(&body, 300);
            return Err(GitError::GitHub(format!(
                "GitHub returned HTTP {code}: {detail}"
            )));
        }

        serde_json::from_str(&body)
            .map_err(|e| GitError::GitHub(format!("could not decode GitHub response: {e}")))
    }
}

/// Split an `owner/repo` template reference into its API fields.
fn split_template(template: Option<&str>) -> (Option<&str>, Option<&str>) {
    match template {
        Some(template) => match template.split_once('/') {
            Some((owner, repo)) => (Some(owner), Some(repo)),
            None => (None, Some(template)),
        },
        None => (None, None),
    }
}

/// Shorten `text` so error messages stay readable.
fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let kept: String = text.chars().take(max_chars).collect();
    format!("{kept}...")
}

/// Template for project creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTemplate {
    /// Template name, for example `web`.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// GitHub template repository (`owner/repo`) when one exists.
    pub github_template: Option<String>,
    /// Files that make up the scaffold.
    pub files: Vec<TemplateFile>,
}

/// A single file belonging to a [`ProjectTemplate`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateFile {
    /// Path relative to the project root.
    pub path: String,
    /// Full file contents.
    pub content: String,
    /// Whether the file should be created executable.
    pub is_executable: bool,
}

/// Whether `path` is a plain relative file path that cannot escape the
/// directory it is joined to on any platform.
fn is_relative_file_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// Build a template entry from embedded contents.
fn template_file(path: &str, content: &str) -> TemplateFile {
    TemplateFile {
        path: path.to_string(),
        content: content.to_string(),
        is_executable: false,
    }
}

/// Marker file written into every generated project.
const FACTORY_README: &str = r"# Factory Artifacts

This directory contains all generated artifacts.
";

const WEB_PACKAGE_JSON: &str = r#"{
  "name": "warsha-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0"
  }
}
"#;

const WEB_TSCONFIG_JSON: &str = r#"{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
"#;

const WEB_VITE_CONFIG: &str = r#"import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
"#;

const WEB_MAIN_TSX: &str = r#"import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";

const container = document.getElementById("root");
if (container) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
"#;

const WEB_APP_TSX: &str = r"export function App() {
  return (
    <main>
      <h1>Warsha</h1>
      <p>Generated by the Warsha factory.</p>
    </main>
  );
}
";

const WEB_INDEX_HTML: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Warsha App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"#;

const WEB_CI: &str = r"name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm build
";

const CLI_CARGO_TOML: &str = r#"[package]
name = "warsha-cli-app"
version = "0.1.0"
edition = "2021"

[dependencies]
clap = { version = "4.5", features = ["derive"] }
"#;

const CLI_MAIN_RS: &str = r#"use clap::Parser;

/// Command-line application generated by Warsha.
#[derive(Parser, Debug)]
struct Args {
    /// Name to greet.
    #[arg(long, default_value = "world")]
    name: String,
}

fn main() {
    let args = Args::parse();
    println!("Hello, {}!", args.name);
}
"#;

const CLI_CI: &str = r"name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo fmt --all --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test
";

const DESKTOP_CARGO_TOML: &str = r#"[package]
name = "warsha-desktop-app"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
"#;

const DESKTOP_TAURI_CONF: &str = r#"{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Warsha Desktop",
  "version": "0.1.0",
  "identifier": "com.warsha.desktop",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Warsha",
        "width": 1100,
        "height": 720
      }
    ]
  }
}
"#;

const DESKTOP_PACKAGE_JSON: &str = r#"{
  "name": "warsha-desktop",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0"
  }
}
"#;

const DESKTOP_MAIN_RS: &str = r#"#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = tauri::Builder::default().run(tauri::generate_context!()) {
        eprintln!("Warsha desktop failed to start: {error}");
    }
}
"#;

const DESKTOP_APP_TSX: &str = r"export function App() {
  return (
    <main>
      <h1>Warsha Desktop</h1>
    </main>
  );
}
";

const DESKTOP_CI: &str = r"name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: cargo test
";

const ANDROID_BUILD_GRADLE: &str = r#"plugins {
    id("com.android.application") version "8.5.0" apply false
    id("org.jetbrains.kotlin.android") version "2.0.0" apply false
}
"#;

const ANDROID_APP_BUILD_GRADLE: &str = r#"plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.warsha.app"
    compileSdk = 34
}
"#;

const ANDROID_MAIN_ACTIVITY: &str = r#"package com.warsha.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Text("Warsha") }
    }
}
"#;

const ANDROID_CI: &str = r"name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - run: ./gradlew build
";

impl ProjectTemplate {
    /// Web application template (React + TypeScript + Vite).
    pub fn web() -> Self {
        Self {
            name: "web".to_string(),
            description: "Web application (React + TypeScript + Vite)".to_string(),
            github_template: Some("warsha/template-web".to_string()),
            files: vec![
                template_file("package.json", WEB_PACKAGE_JSON),
                template_file("tsconfig.json", WEB_TSCONFIG_JSON),
                template_file("vite.config.ts", WEB_VITE_CONFIG),
                template_file("src/main.tsx", WEB_MAIN_TSX),
                template_file("src/App.tsx", WEB_APP_TSX),
                template_file("index.html", WEB_INDEX_HTML),
                template_file(".github/workflows/ci.yml", WEB_CI),
                template_file("factory/README.md", FACTORY_README),
            ],
        }
    }

    /// Command-line application template (Rust).
    pub fn cli() -> Self {
        Self {
            name: "cli".to_string(),
            description: "Command-line application (Rust)".to_string(),
            github_template: Some("warsha/template-cli".to_string()),
            files: vec![
                template_file("Cargo.toml", CLI_CARGO_TOML),
                template_file("src/main.rs", CLI_MAIN_RS),
                template_file(".github/workflows/ci.yml", CLI_CI),
                template_file("factory/README.md", FACTORY_README),
            ],
        }
    }

    /// Desktop application template (Tauri + React).
    pub fn desktop() -> Self {
        Self {
            name: "desktop".to_string(),
            description: "Desktop application (Tauri + React)".to_string(),
            github_template: Some("warsha/template-desktop".to_string()),
            files: vec![
                template_file("Cargo.toml", DESKTOP_CARGO_TOML),
                template_file("tauri.conf.json", DESKTOP_TAURI_CONF),
                template_file("package.json", DESKTOP_PACKAGE_JSON),
                template_file("src/main.rs", DESKTOP_MAIN_RS),
                template_file("src/App.tsx", DESKTOP_APP_TSX),
                template_file(".github/workflows/ci.yml", DESKTOP_CI),
                template_file("factory/README.md", FACTORY_README),
            ],
        }
    }

    /// Android application template (Kotlin + Jetpack Compose).
    pub fn android() -> Self {
        Self {
            name: "android".to_string(),
            description: "Android application (Kotlin + Jetpack Compose)".to_string(),
            github_template: Some("warsha/template-android".to_string()),
            files: vec![
                template_file("build.gradle.kts", ANDROID_BUILD_GRADLE),
                template_file("app/build.gradle.kts", ANDROID_APP_BUILD_GRADLE),
                template_file(
                    "app/src/main/java/com/warsha/app/MainActivity.kt",
                    ANDROID_MAIN_ACTIVITY,
                ),
                template_file(".github/workflows/ci.yml", ANDROID_CI),
                template_file("factory/README.md", FACTORY_README),
            ],
        }
    }

    /// Every shipped template.
    pub fn all() -> Vec<Self> {
        vec![Self::web(), Self::cli(), Self::desktop(), Self::android()]
    }

    /// Look a template up by name.
    pub fn by_name(name: &str) -> Option<Self> {
        Self::all().into_iter().find(|t| t.name == name)
    }

    /// Write every template file below `root`, creating directories as needed.
    pub fn scaffold(&self, root: &Path) -> Result<()> {
        std::fs::create_dir_all(root)?;
        for file in &self.files {
            let path = file.path.as_str();
            let relative = Path::new(path);
            if !is_relative_file_path(relative) {
                return Err(GitError::Other(format!("invalid template path: {path}")));
            }
            let target = root.join(relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&target, file.content.as_bytes())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_repository_in_temp_dir() {
        let dir = tempfile::tempdir().expect("temp dir");
        let repo = GitRepo::init(dir.path()).expect("init repository");

        assert_eq!(repo.path().as_path(), dir.path());
        assert!(repo.path().join(".git").exists());
        assert!(repo.status().expect("status").is_empty());

        let reopened = GitRepo::open(dir.path()).expect("open repository");
        assert_eq!(reopened.path().as_path(), dir.path());
    }

    #[test]
    fn open_rejects_a_missing_directory() {
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("no-such-repo");
        assert!(matches!(GitRepo::open(&missing), Err(GitError::Git(_))));
    }

    #[test]
    fn project_templates_are_complete() {
        let templates = ProjectTemplate::all();
        assert_eq!(templates.len(), 4);

        for template in &templates {
            assert!(!template.files.is_empty());
            for file in &template.files {
                assert!(!file.path.is_empty());
                assert!(!file.content.is_empty());
            }
        }

        let web = ProjectTemplate::by_name("web").expect("web template");
        assert_eq!(web.name, "web");
        assert!(web.github_template.is_some());
        assert!(ProjectTemplate::by_name("nope").is_none());
    }

    #[test]
    fn scaffold_writes_template_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        ProjectTemplate::cli()
            .scaffold(dir.path())
            .expect("scaffold template");

        let manifest = dir.path().join("Cargo.toml");
        let written = std::fs::read_to_string(&manifest).expect("read manifest");
        assert!(written.contains("warsha-cli-app"));
        assert!(dir.path().join("factory/README.md").exists());
        assert!(dir.path().join("src/main.rs").exists());
    }

    #[test]
    fn scaffold_rejects_paths_that_escape_the_root() {
        let dir = tempfile::tempdir().expect("temp dir");
        for bad in ["../escape.txt", "/etc/passwd", ""] {
            let template = ProjectTemplate {
                name: "bad".to_string(),
                description: "bad template".to_string(),
                github_template: None,
                files: vec![template_file(bad, "nope")],
            };

            assert!(matches!(
                template.scaffold(dir.path()),
                Err(GitError::Other(_))
            ));
        }
        assert!(!dir.path().join("escape.txt").exists());
    }

    #[test]
    fn slugify_branch_name_normalizes_titles() {
        assert_eq!(slugify_branch_name("Add Login Page!"), "add-login-page");
        assert_eq!(
            slugify_branch_name("  spaces   and---dashes  "),
            "spaces-and-dashes"
        );
        assert_eq!(slugify_branch_name("!!!"), FALLBACK_SLUG);
        assert_eq!(slugify_branch_name(""), FALLBACK_SLUG);
        assert!(slugify_branch_name(&"a".repeat(200)).len() <= MAX_SLUG_LEN);
    }

    #[test]
    fn run_branch_names_use_the_run_id() {
        let branch = branch_name_for_run(RunId::new());
        assert!(branch.starts_with("warsha/"));
        assert_eq!(branch.len(), "warsha/".len() + 26);
    }

    #[test]
    fn create_branch_rejects_invalid_names() {
        let dir = tempfile::tempdir().expect("temp dir");
        let repo = GitRepo::init(dir.path()).expect("init repository");

        assert!(matches!(
            repo.create_branch("-oops", "main"),
            Err(GitError::Other(_))
        ));
        assert!(matches!(repo.checkout("bad name"), Err(GitError::Other(_))));
        assert!(matches!(repo.push("origin", "-f"), Err(GitError::Other(_))));
        assert!(matches!(
            repo.create_branch("feature", "-bad"),
            Err(GitError::Other(_))
        ));
    }

    #[test]
    fn commit_rejects_an_empty_message() {
        let dir = tempfile::tempdir().expect("temp dir");
        let repo = GitRepo::init(dir.path()).expect("init repository");
        assert!(matches!(repo.commit("   "), Err(GitError::Other(_))));
    }

    #[test]
    fn github_client_requires_a_token() {
        assert!(matches!(
            GitHubClient::new("   "),
            Err(GitError::AuthRequired)
        ));
    }

    #[test]
    fn github_requests_carry_required_headers() {
        let client = GitHubClient::new("test-token").expect("client");
        assert_eq!(client.api_base, GITHUB_API_BASE);

        let request = client
            .authorized(client.client.get("https://api.github.com/rate_limit"))
            .build()
            .expect("request");

        let header = |name: &str| {
            request
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_string()
        };

        assert_eq!(header("authorization"), "Bearer test-token");
        assert_eq!(header("user-agent"), USER_AGENT);
        assert_eq!(header("accept"), GITHUB_ACCEPT);
    }

    #[test]
    fn split_template_understands_owner_repo_references() {
        assert_eq!(split_template(None), (None, None));
        assert_eq!(
            split_template(Some("warsha/template-web")),
            (Some("warsha"), Some("template-web"))
        );
        assert_eq!(
            split_template(Some("template-web")),
            (None, Some("template-web"))
        );
    }

    #[test]
    fn merge_methods_map_to_api_values() {
        assert_eq!(MergeMethod::Merge.as_str(), "merge");
        assert_eq!(MergeMethod::Squash.as_str(), "squash");
        assert_eq!(MergeMethod::Rebase.as_str(), "rebase");
        assert_eq!(MergeMethod::default(), MergeMethod::Merge);
        assert_eq!(MergeMethod::Squash.to_string(), "squash");
    }
}
