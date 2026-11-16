use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
pub struct DeviceAuthInfo {
    pub user_code: String,
    pub verification_uri: String,
}

#[derive(Deserialize)]
#[allow(dead_code)] // expires_in drives the poll deadline once the flow is wired to a provider
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

pub async fn start_device_flow(
    client: &reqwest::Client,
    token_endpoint: &str,
    device_auth_endpoint: &str,
    client_id: &str,
) -> anyhow::Result<(DeviceAuthInfo, String)> {
    // 1. Get device code
    let response = client
        .post(device_auth_endpoint)
        .form(&[("client_id", client_id)])
        .send()
        .await?
        .json::<DeviceCodeResponse>()
        .await?;

    let auth_info = DeviceAuthInfo {
        user_code: response.user_code,
        verification_uri: response.verification_uri,
    };

    // 2. Poll token endpoint
    let mut interval = tokio::time::interval(Duration::from_secs(response.interval));
    loop {
        interval.tick().await;

        let token_resp = client
            .post(token_endpoint)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", &response.device_code),
                ("client_id", client_id),
            ])
            .send()
            .await?;

        if token_resp.status().is_success() {
            return Ok((auth_info, token_resp.text().await?));
        }
    }
}
