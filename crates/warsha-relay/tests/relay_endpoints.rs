//! Integration tests for the relay's inbound endpoints (security audit H-01, H-02).
//!
//! These drive a real listener on loopback: an HTTP submission, a WebSocket handshake
//! and the frames that go through it. The point is what the wire sees — a 401 for a
//! caller with no credential, a 403 for one that claims to be a device it is not, a
//! 429 for a caller past its ceiling — which a unit test of a handler function cannot
//! show, because the handler is only reached through the routing and the connect-info
//! that decide them.
//!
//! The WebSocket client here is the short `raw_ws` module below rather than a crate:
//! adding a dependency would rewrite `Cargo.lock`, which this task does not own, and a
//! handshake plus masked binary frames is a small enough thing to state exactly.

use chrono::Utc;
use std::io::ErrorKind;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use warsha_core::DeviceId;
use warsha_relay::{RelayLimits, RelayState};
use warsha_remote::rate_limit::Quota;
use warsha_remote::{EncryptedFrame, PairingData, RelayTrust};

/// How long a test waits for anything the relay is expected to answer.
const WAIT: Duration = Duration::from_secs(5);

/// One paired device: its id, its pairing, and the bearer token its secret became.
struct Device {
    id: DeviceId,
    token: String,
    pairing: PairingData,
}

impl Device {
    fn new(name: &str) -> Self {
        let identity = warsha_remote::DeviceIdentity::generate(name.to_string())
            .expect("a device identity is generated");
        let pairing = PairingData::new(&identity, None).expect("a pairing is built");
        Self {
            id: identity.device_id,
            token: pairing.secret_token(),
            pairing,
        }
    }
}

/// A relay serving `pairings` on an ephemeral loopback port, with the ceilings the
/// test named.
async fn serve(pairings: Vec<PairingData>, limits: RelayLimits) -> (SocketAddr, Arc<RelayState>) {
    let state = Arc::new(RelayState::with_limits(
        RelayTrust::from_pairings(&pairings),
        1024,
        4,
        limits,
    ));
    let (addr, _server) = warsha_relay::serve(state.clone(), "127.0.0.1:0")
        .await
        .expect("the relay serves");
    (addr, state)
}

/// A frame of `ciphertext` from `from` to `to`.
fn frame(from: DeviceId, to: DeviceId, ciphertext: Vec<u8>) -> EncryptedFrame {
    EncryptedFrame {
        from,
        to,
        nonce: [0u8; 12],
        ciphertext,
        timestamp: Utc::now(),
    }
}

/// The bytes a socket writes for a frame, in the encoding the relay reads.
fn encoded(frame: &EncryptedFrame) -> Vec<u8> {
    serde_json::to_vec(frame).expect("a frame is encoded")
}

async fn post_frame(
    addr: SocketAddr,
    token: Option<&str>,
    body: &EncryptedFrame,
) -> reqwest::Response {
    let request = reqwest::Client::new()
        .post(format!("http://{addr}/frame"))
        .json(body);
    match token {
        Some(token) => request
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .expect("the relay answers"),
        None => request.send().await.expect("the relay answers"),
    }
}

/// A minimal WebSocket client: the upgrade, masked binary frames, unmasked reads.
mod raw_ws {
    use super::*;

    /// The RFC 6455 example key. Its accept value is not checked: what these tests
    /// assert is the status the relay answered and the frames it carried.
    const EXAMPLE_KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";

    /// An open WebSocket connection to the relay.
    pub struct Socket {
        stream: TcpStream,
        /// Bytes read past the end of the handshake header.
        leftover: Vec<u8>,
    }

    /// Send the upgrade request and read the status the relay answered with.
    ///
    /// The connection comes back only when the relay answered at all; a 401 or a 403
    /// is the refusal, and there is nothing to speak frames on.
    pub async fn open(addr: SocketAddr, query: &str, token: Option<&str>) -> (u16, Option<Socket>) {
        let mut stream = TcpStream::connect(addr)
            .await
            .expect("the relay accepts a connection");

        let path = if query.is_empty() {
            "/ws".to_string()
        } else {
            format!("/ws?{query}")
        };
        let mut request = format!(
            "GET {path} HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {EXAMPLE_KEY}\r\nSec-WebSocket-Version: 13\r\n"
        );
        if let Some(token) = token {
            request.push_str(&format!("Authorization: Bearer {token}\r\n"));
        }
        request.push_str("\r\n");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("the handshake is written");

        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            let read = stream
                .read(&mut byte)
                .await
                .expect("the relay answers the handshake");
            if read == 0 {
                panic!("the relay closed the connection without a response");
            }
            head.push(byte[0]);
            if head.ends_with(b"\r\n\r\n") {
                break;
            }
            if head.len() > 8192 {
                panic!("the handshake response never ended");
            }
        }

        let text = String::from_utf8_lossy(&head).to_string();
        let status = text
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse::<u16>().ok())
            .unwrap_or_else(|| panic!("no status line in a handshake response: {text}"));

        // The header was read byte by byte up to and including its terminator, so
        // nothing of a frame is left over in `head`.
        (
            status,
            Some(Socket {
                stream,
                leftover: Vec::new(),
            }),
        )
    }

    impl Socket {
        /// Write one masked binary frame, as a client must.
        pub async fn send(&mut self, payload: &[u8]) {
            let mut frame = vec![0x82u8]; // FIN + binary
            let len = payload.len();
            if len < 126 {
                frame.push(0x80 | len as u8);
            } else if len <= u16::MAX as usize {
                frame.push(0x80 | 126);
                frame.extend_from_slice(&(len as u16).to_be_bytes());
            } else {
                frame.push(0x80 | 127);
                frame.extend_from_slice(&(len as u64).to_be_bytes());
            }
            let mask = [0x1a, 0x2b, 0x3c, 0x4d];
            frame.extend_from_slice(&mask);
            frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));

            self.stream
                .write_all(&frame)
                .await
                .expect("the frame is written");
        }

        /// Read one data frame, or `None` once the relay has closed the channel.
        ///
        /// A ping or a pong in between is skipped: that is the relay keeping the
        /// socket alive, not the frame the test is waiting for.
        pub async fn read(&mut self) -> Option<Vec<u8>> {
            loop {
                let mut head = [0u8; 2];
                if !self.read_exact_or_closed(&mut head).await {
                    return None;
                }
                let opcode = head[0] & 0x0f;
                if head[1] & 0x80 != 0 {
                    panic!("a relay must not mask the frames it sends");
                }
                let mut len = usize::from(head[1] & 0x7f);
                if len == 126 {
                    let mut ext = [0u8; 2];
                    if !self.read_exact_or_closed(&mut ext).await {
                        return None;
                    }
                    len = usize::from(u16::from_be_bytes(ext));
                } else if len == 127 {
                    let mut ext = [0u8; 8];
                    if !self.read_exact_or_closed(&mut ext).await {
                        return None;
                    }
                    len = usize::from_be_bytes(ext);
                }

                let mut payload = vec![0u8; len];
                if len > 0 && !self.read_exact_or_closed(&mut payload).await {
                    return None;
                }
                match opcode {
                    2 => return Some(payload),
                    8 | 0 => return None,
                    _ => continue,
                }
            }
        }

        /// Fill `buffer`, reporting a closed connection rather than panicking on it.
        async fn read_exact_or_closed(&mut self, buffer: &mut [u8]) -> bool {
            let mut filled = 0;
            while filled < buffer.len() {
                if self.leftover.is_empty() {
                    let mut chunk = [0u8; 4096];
                    match self.stream.read(&mut chunk).await {
                        Ok(0) => return false,
                        Ok(read) => self.leftover.extend_from_slice(&chunk[..read]),
                        Err(error) if error.kind() == ErrorKind::UnexpectedEof => return false,
                        Err(error) => panic!("the socket failed: {error}"),
                    }
                } else {
                    let take = self.leftover.len().min(buffer.len() - filled);
                    buffer[filled..filled + take].copy_from_slice(&self.leftover[..take]);
                    self.leftover.drain(..take);
                    filled += take;
                }
            }
            true
        }
    }
}

/// The status a `/ws` handshake was answered with.
async fn handshake_status(addr: SocketAddr, query: &str, token: Option<&str>) -> u16 {
    let (status, _socket) = raw_ws::open(addr, query, token).await;
    status
}

/// Open a `/ws` channel with a device's own credential.
async fn connect(addr: SocketAddr, token: &str) -> raw_ws::Socket {
    let (status, socket) = raw_ws::open(addr, "", Some(token)).await;
    assert_eq!(status, 101, "an authenticated socket was not upgraded");
    socket.expect("a 101 comes with a connection")
}

/// Read one frame off a socket, or fail the test.
async fn next_frame(socket: &mut raw_ws::Socket, what: &str) -> EncryptedFrame {
    let bytes = tokio::time::timeout(WAIT, socket.read())
        .await
        .unwrap_or_else(|_| panic!("no frame arrived on this socket ({what})"))
        .unwrap_or_else(|| panic!("the relay closed the socket ({what})"));
    serde_json::from_slice(&bytes).expect("the frame is the JSON the relay forwarded")
}

/// Audit H-02, the submission path: a frame is only ever carried for the device its
/// credential authenticates.
#[tokio::test]
async fn an_unauthenticated_or_mismatched_submission_is_refused() {
    let alice = Device::new("Alice");
    let bob = Device::new("Bob");
    let stranger = DeviceId::new();
    let (addr, state) = serve(
        vec![alice.pairing.clone(), bob.pairing.clone()],
        RelayLimits::default(),
    )
    .await;
    // Bob listens; that is the channel the delivery is checked against.
    let mut bob_rx = state.register(bob.id).await.expect("bob's channel");

    // 1. No credential at all. Before this batch the relay forwarded it.
    let response = post_frame(addr, None, &frame(alice.id, bob.id, vec![1])).await;
    assert_eq!(
        response.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "an unauthenticated frame was not refused"
    );

    // 2. A credential this relay was never given.
    let forged = Device::new("Mallory");
    let response = post_frame(addr, Some(&forged.token), &frame(alice.id, bob.id, vec![1])).await;
    assert_eq!(
        response.status(),
        reqwest::StatusCode::UNAUTHORIZED,
        "an unknown pairing opened a submission path"
    );

    // 3. Alice's own credential, but the frame claims to come from somebody else —
    //    the exact client-asserted identity the audit names.
    let response = post_frame(addr, Some(&alice.token), &frame(stranger, bob.id, vec![1])).await;
    assert_eq!(
        response.status(),
        reqwest::StatusCode::FORBIDDEN,
        "a spoofed frame sender was carried"
    );
    assert!(bob_rx.try_recv().is_err(), "the spoofed frame reached bob");

    // 4. Alice submitting her own frame is the request that is allowed.
    let response = post_frame(
        addr,
        Some(&alice.token),
        &frame(alice.id, bob.id, vec![7, 8]),
    )
    .await;
    assert_eq!(response.status(), reqwest::StatusCode::ACCEPTED);
    let delivered = tokio::time::timeout(WAIT, bob_rx.recv())
        .await
        .expect("the frame is delivered promptly")
        .expect("bob's channel is open");
    assert_eq!(delivered.from, alice.id);
    assert_eq!(delivered.to, bob.id);
    assert_eq!(delivered.ciphertext, vec![7, 8]);
}

/// The frame ceiling is enforced on the way in, not only on the way out.
#[tokio::test]
async fn an_oversized_frame_is_refused_with_413() {
    let alice = Device::new("Alice");
    let bob = Device::new("Bob");
    let (addr, _state) = serve(
        vec![alice.pairing.clone(), bob.pairing.clone()],
        RelayLimits::default(),
    )
    .await;

    let response = post_frame(
        addr,
        Some(&alice.token),
        &frame(alice.id, bob.id, vec![0u8; 4096]),
    )
    .await;
    assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
}

/// Audit H-01: submissions are bounded per authenticated device and answer 429 with
/// a wait, and one device's ceiling is not another device's refusal.
#[tokio::test]
async fn a_caller_past_its_ceiling_is_answered_429_with_a_retry_after() {
    let alice = Device::new("Alice");
    let bob = Device::new("Bob");
    let (addr, _state) = serve(
        vec![alice.pairing.clone(), bob.pairing.clone()],
        RelayLimits {
            frame: Quota::new(2, 1, 60),
            ..RelayLimits::default()
        },
    )
    .await;

    assert_eq!(
        post_frame(addr, Some(&alice.token), &frame(alice.id, bob.id, vec![1]))
            .await
            .status(),
        reqwest::StatusCode::ACCEPTED
    );
    assert_eq!(
        post_frame(addr, Some(&alice.token), &frame(alice.id, bob.id, vec![1]))
            .await
            .status(),
        reqwest::StatusCode::ACCEPTED
    );
    let refused = post_frame(addr, Some(&alice.token), &frame(alice.id, bob.id, vec![1])).await;
    assert_eq!(
        refused.status(),
        reqwest::StatusCode::TOO_MANY_REQUESTS,
        "a device past its frame ceiling was still served"
    );
    let retry_after = refused
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_else(|| panic!("a 429 carried no Retry-After"))
        .to_string();
    assert!(
        retry_after
            .parse::<u64>()
            .expect("a whole number of seconds")
            >= 1,
        "Retry-After was {retry_after}"
    );

    // Bob is not answerable for Alice's ceiling: the limit is per authenticated
    // device, not per relay.
    assert_eq!(
        post_frame(addr, Some(&bob.token), &frame(bob.id, alice.id, vec![1]))
            .await
            .status(),
        reqwest::StatusCode::ACCEPTED,
        "one device's traffic refused another device's"
    );
}

/// Audit H-02, the channel path: a `/ws` upgrade with no credential is refused
/// outright, and a `device_id` on the query string can only ever confirm the
/// authenticated device, never replace it.
#[tokio::test]
async fn a_channel_without_a_credential_or_with_a_claimed_identity_is_refused() {
    let alice = Device::new("Alice");
    let mallory = Device::new("Mallory");
    let (addr, _state) = serve(vec![alice.pairing.clone()], RelayLimits::default()).await;

    // No Authorization header and no `token` query parameter: nothing authenticates.
    assert_eq!(
        handshake_status(addr, "", None).await,
        401,
        "an unauthenticated socket was upgraded"
    );

    // Alice's credential with Mallory's id on the query string: the claim is checked
    // against the secret and loses. The identity is never what the query said.
    assert_eq!(
        handshake_status(
            addr,
            &format!("device_id={}", mallory.id),
            Some(&alice.token)
        )
        .await,
        403,
        "a client-asserted device id overrode the authenticated one"
    );

    // The matching claim is the one that goes through, and the credential still
    // decides whose it is.
    assert_eq!(
        handshake_status(addr, &format!("device_id={}", alice.id), Some(&alice.token)).await,
        101,
        "a correct claim was refused"
    );
}

/// The query-parameter credential a client that cannot set headers has to use
/// authenticates the same device as the header form.
#[tokio::test]
async fn a_query_credential_authenticates_the_same_device_as_a_header() {
    let alice = Device::new("Alice");
    let bob = Device::new("Bob");
    let (addr, _state) = serve(
        vec![alice.pairing.clone(), bob.pairing.clone()],
        RelayLimits::default(),
    )
    .await;

    let (status, maybe_socket) = raw_ws::open(addr, &format!("token={}", alice.token), None).await;
    assert_eq!(status, 101, "a query credential did not open a channel");
    let mut alice_socket = maybe_socket.expect("a 101 comes with a connection");
    let mut bob_socket = connect(addr, &bob.token).await;

    alice_socket
        .send(&encoded(&frame(alice.id, bob.id, vec![42])))
        .await;
    let delivered = next_frame(&mut bob_socket, "bob receives alice's frame").await;
    assert_eq!(delivered.from, alice.id);
    assert_eq!(delivered.ciphertext, vec![42]);
}

/// Audit H-02 in both directions over real sockets: frames reach the device that is
/// listening for them, and a device that puts another device's id on a frame loses
/// its channel rather than gaining its voice.
#[tokio::test]
async fn an_open_channel_delivers_to_its_owner_and_refuses_another_identity() {
    let alice = Device::new("Alice");
    let bob = Device::new("Bob");
    let (addr, _state) = serve(
        vec![alice.pairing.clone(), bob.pairing.clone()],
        RelayLimits::default(),
    )
    .await;

    let mut alice_socket = connect(addr, &alice.token).await;
    let mut bob_socket = connect(addr, &bob.token).await;

    // Inbound: Alice's own frame, out to Bob's socket.
    alice_socket
        .send(&encoded(&frame(alice.id, bob.id, vec![1, 2, 3])))
        .await;
    let delivered = next_frame(&mut bob_socket, "bob receives alice's frame").await;
    assert_eq!(delivered.from, alice.id);
    assert_eq!(delivered.ciphertext, vec![1, 2, 3]);

    // Outbound the other way, on the same rule.
    bob_socket
        .send(&encoded(&frame(bob.id, alice.id, vec![9])))
        .await;
    let reply = next_frame(&mut alice_socket, "alice receives bob's frame").await;
    assert_eq!(reply.from, bob.id);

    // A mismatch ends the channel: Bob cannot speak as Alice, and the relay does not
    // pretend that might be traffic worth carrying.
    bob_socket
        .send(&encoded(&frame(alice.id, alice.id, vec![9])))
        .await;
    let closed = tokio::time::timeout(WAIT, bob_socket.read())
        .await
        .expect("the relay answered rather than hanging");
    assert!(
        closed.is_none(),
        "a spoofed frame left bob's channel open: {closed:?}"
    );
}

/// `/health` stays open to a probe but is bounded like everything else.
#[tokio::test]
async fn the_health_endpoint_is_bounded_per_peer() {
    let (addr, _state) = serve(
        vec![],
        RelayLimits {
            health: Quota::new(2, 1, 60),
            ..RelayLimits::default()
        },
    )
    .await;
    let client = reqwest::Client::new();

    let first = client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .expect("the relay answers");
    assert_eq!(first.status(), reqwest::StatusCode::OK);
    client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .expect("the relay answers");

    let refused = client
        .get(format!("http://{addr}/health"))
        .send()
        .await
        .expect("the relay answers");
    assert_eq!(
        refused.status(),
        reqwest::StatusCode::TOO_MANY_REQUESTS,
        "an unbounded health probe was the free path past the relay's limits"
    );
}

/// A relay with no pairing list admits nobody — it is not an open relay.
#[tokio::test]
async fn a_relay_without_pairings_authenticates_no_channel() {
    let alice = Device::new("Alice");
    let (addr, _state) = serve(vec![], RelayLimits::default()).await;

    assert_eq!(
        handshake_status(addr, "", Some(&alice.token)).await,
        401,
        "a relay trusting nobody upgraded a socket"
    );

    let response = post_frame(
        addr,
        Some(&alice.token),
        &frame(alice.id, alice.id, vec![1]),
    )
    .await;
    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
}
