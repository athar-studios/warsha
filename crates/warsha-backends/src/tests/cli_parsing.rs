use super::super::*;

#[test]
fn test_claude_cli_parse() {
    let json = include_str!("../../tests/fixtures/claude_cli_output.json");
    let cli_out: CliOutput = serde_json::from_str(json).expect("failed to parse Claude CLI JSON");

    assert_eq!(cli_out.usage.as_ref().unwrap().input_tokens, 100);
    assert_eq!(cli_out.usage.as_ref().unwrap().output_tokens, 50);

    // Canary test: assert canary string not in usage
    let usage_debug = format!("{:?}", cli_out.usage);
    assert!(!usage_debug.contains("WARSHA-CANARY-"));
}

#[test]
fn test_codex_cli_parse() {
    let jsonl = include_str!("../../tests/fixtures/codex_cli_output.jsonl");
    let mut total_input = 0;
    let mut total_output = 0;

    for line in jsonl.lines() {
        let line_out: serde_json::Value =
            serde_json::from_str(line).expect("failed to parse Codex JSONL line");
        if let Some(u) = line_out.get("usage") {
            total_input += u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
            total_output += u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);

            // Canary check: assert it is not in the usage object
            let usage_str = u.to_string();
            assert!(!usage_str.contains("WARSHA-CANARY-"));
        }
    }

    assert_eq!(total_input, 100);
    assert_eq!(total_output, 50);
}
