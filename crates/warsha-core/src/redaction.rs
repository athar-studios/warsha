//! Redaction and secret masking for audit logs, error reporting, and query strings (F4).

pub const REDACTED: &str = "[REDACTED]";

const SECRET_PARAMS: &[&str] = &[
    "api_key",
    "access_token",
    "apikey",
    "token",
    "secret",
    "key",
];

/// Redact secret query string parameters (`?key=...`, `&api_key=...`, `&token=...`) from URLs.
pub fn mask_query_secrets(input: &str) -> String {
    let mut result = input.to_string();
    for param in SECRET_PARAMS {
        for prefix in [format!("?{param}="), format!("&{param}=")] {
            let mut search_from = 0;
            while let Some(pos) = result[search_from..].to_lowercase().find(&prefix) {
                let start_idx = search_from + pos + prefix.len();
                let end_idx = result[start_idx..]
                    .find(|c: char| {
                        c == '&' || c.is_whitespace() || c == '"' || c == '\'' || c == '`'
                    })
                    .map(|offset| start_idx + offset)
                    .unwrap_or(result.len());

                result.replace_range(start_idx..end_idx, REDACTED);
                search_from = start_idx + REDACTED.len();
            }
        }
    }
    result
}

/// Redact secrets, tokens, and URL query-string secrets.
pub fn mask_secrets(input: &str) -> String {
    mask_query_secrets(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_url_query_parameters() {
        assert_eq!(
            mask_secrets("https://api.openai.com/v1?key=sk-abc123456&foo=bar"),
            "https://api.openai.com/v1?key=[REDACTED]&foo=bar"
        );
        assert_eq!(
            mask_secrets("https://api.anthropic.com/v1?foo=bar&api_key=secret-token"),
            "https://api.anthropic.com/v1?foo=bar&api_key=[REDACTED]"
        );
        assert_eq!(
            mask_secrets("curl 'http://localhost:3000/api?token=mytoken&secret=topsecret'"),
            "curl 'http://localhost:3000/api?token=[REDACTED]&secret=[REDACTED]'"
        );
    }
}
