use std::net::{Ipv4Addr, SocketAddr};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub async fn start_pkce_flow() -> anyhow::Result<String> {
    let listener = TcpListener::bind(SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 0)).await?;
    let port = listener.local_addr()?.port();

    tracing::info!("Listening on port {}", port);

    // In a real implementation, we would open the browser here.
    // For now, return the port so the caller can construct the URL.

    let (mut stream, _) = listener.accept().await?;
    let mut buffer = [0; 2048];
    let n = stream.read(&mut buffer).await?;
    let request = String::from_utf8_lossy(&buffer[..n]);

    // Parse the code from the request
    let code = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|path| path.split('?').nth(1))
        .and_then(|query| query.split('&').find(|pair| pair.starts_with("code=")))
        .map(|pair| pair.trim_start_matches("code="))
        .ok_or_else(|| anyhow::anyhow!("Failed to extract auth code"))?;

    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nAuth success! You can close this window.";
    stream.write_all(response.as_bytes()).await?;

    Ok(code.to_string())
}
