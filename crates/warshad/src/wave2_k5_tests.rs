use super::*;

fn args(values: &[&str]) -> Vec<String> {
    values
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>()
}

#[test]
fn pin_grammar_rejects_ranges_and_accepts_exact_pins() {
    assert!(require_pinned_launch("npx", &args(&["@scope/server@1.2.3"])).is_ok());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@1.2.3-rc.1+build.5"])).is_ok());
    assert!(require_pinned_launch("uvx", &args(&["mcp-server@0.4.2"])).is_ok());
    assert!(require_pinned_launch("npx", &args(&[])).is_err());
}

#[test]
fn pin_grammar_rejects_wildcards_ranges_and_unpinned_semver() {
    assert!(require_pinned_launch("npx", &args(&["@scope/server@1.2.x"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@1.x.x"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@*"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@^1.2.3"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@~1.2.3"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@>=1.2.3"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server@latest"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["@scope/server"])).is_err());
}

#[test]
fn pin_grammar_handles_package_flag_options() {
    assert!(require_pinned_launch("npx", &args(&["--package=@scope/server"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["--package", "@scope/server"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["-p", "@scope/server@^1.0.0"])).is_err());
    assert!(require_pinned_launch("npx", &args(&["--package=@scope/server@1.2.3"])).is_ok());
    assert!(require_pinned_launch("npx", &args(&["--package", "@scope/server@1.2.3"])).is_ok());
    assert!(require_pinned_launch("npx", &args(&["-y", "@scope/server@1.2.3"])).is_ok());
}

#[test]
fn pin_grammar_allows_legitimate_server_args_after_pinned_package() {
    assert!(require_pinned_launch(
        "npx",
        &args(&["@scope/server@1.2.3", "/allowed/root", "--port", "3000"])
    )
    .is_ok());
    assert!(require_pinned_launch("npx", &args(&["-y", "mcp-fs@2.0.1", "--stdio", "."])).is_ok());
    assert!(require_pinned_launch("pnpm", &args(&["run", "dev"])).is_ok());
}

#[test]
fn transport_bypass_rejects_a_non_stdio_command() {
    let http_with_command =
        r#"{"name":"x","transport":"http","command":"/bin/sh","args":["-c","id"]}"#;
    assert!(
        parse_plugin_manifest(http_with_command).is_err(),
        "a non-stdio manifest must not carry a program to spawn"
    );
    let http_without_command = r#"{"name":"x","transport":"http"}"#;
    assert!(parse_plugin_manifest(http_without_command).is_ok());
    let stdio_pinned = r#"{"name":"x","transport":"stdio","command":"npx","args":["pkg@1.2.3"]}"#;
    assert!(parse_plugin_manifest(stdio_pinned).is_ok());
}

#[test]
fn transport_bypass_rejects_sse_with_command() {
    let sse_with_command = r#"{"name":"x","transport":"sse","command":"python3"}"#;
    assert!(
        parse_plugin_manifest(sse_with_command).is_err(),
        "sse manifest with command must be rejected"
    );
}

#[test]
fn transport_bypass_accepts_clean_http_and_stdio() {
    let http_clean = r#"{"name":"clean-http","transport":"http"}"#;
    assert!(parse_plugin_manifest(http_clean).is_ok());
    let stdio_clean =
        r#"{"name":"clean-stdio","transport":"stdio","command":"npx","args":["pkg@1.2.3"]}"#;
    assert!(parse_plugin_manifest(stdio_clean).is_ok());
}
