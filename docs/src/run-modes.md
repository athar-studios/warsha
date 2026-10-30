# Run Modes

<div dir="rtl" lang="ar">

## أوضاع التشغيل: محلي، استضافة ذاتية، مُستضاف

ورشة تعمل في واحد من ثلاثة أماكن، والفرق بينها ليس شكليًا: هو الذي يحدّد أي واجهة
يفتحها الخادم (`warshad`) وأي الأجهزة يردّ عليها.

- **محلي** — جهاز واحد. الخادم يستمع على `127.0.0.1` فقط، فلا شيء خارج الجهاز
  يستطيع الاتصال به، والتهيئة لا تحمل قائمة مضيفين ولا مرحّلًا.
- **استضافة ذاتية** — خادم المالك أو جهاز في شبكته المحلية. الخادم يستمع على
  واجهة صريحة غير محلية (الافتراضي `0.0.0.0`)، و**يجب** أن تحمل التهيئة قائمة
  مضيفين مسموحًا بها. "اسمع على كل الواجهات" بلا تسمية من يُسمح له بالاتصال ثغرة
  مفتوحة، لا وضعًا.
- **مُستضاف** — الوضع القائم على المرحّل. الواجهة تبقى على `127.0.0.1` ولا تُفتح
  أبدًا للشبكة؛ الأجهزة البعيدة تصل عبر `relay_url`، والمرحّل ينقل نصًا مشفّرًا
  فقط، كما في فصل [الأمان](security.md).

**الاقتران بالهاتف مطلوب في الأوضاع الثلاثة.** الهاتف جهاز بعيد حتى لو كان الخادم
محليًا، والاستماع على `127.0.0.1` لا يجعل هاتف شخص آخر محليًا. لذلك
`requires_pairing()` تعود `true` في كل وضع، والاقتران هو مسار M6 نفسه (رمز QR +
سرّ لمرة واحدة)، مع سجل يستطيع المالك سحب الجهاز منه في أي وضع.

القاعدة التي لا تتغيّر: هذه الوحدة **لا تفتح مقبسًا**. `bind_host` بيانات يقرأها
الخادم لاحقًا، و`relay_url` نصّ لا اتصال. لا قراءة ملفات، ولا شبكة، ولا حفظ على
القرص في هذه الوحدة.

</div>

## English

Run modes are the three places Warsha is deployed — Local, Self-hosted and Hosted —
and the mode decides two things and only two things: which interface the daemon
binds, and which peers it will answer. This chapter is the long form of
`crates/warsha-pipeline/src/run_modes.rs`.

| Deliverable              | Path                                              |
| ------------------------ | ------------------------------------------------- |
| The mode rules and store | `crates/warsha-pipeline/src/run_modes.rs`         |
| The badge                | `apps/desktop/src/components/RunModeBadge.tsx`    |
| This chapter             | `docs/src/run-modes.md`                           |
| Tests                    | `run_modes::tests` in Rust (16), `RunModeBadge.test.tsx` (5) |

### The three modes

| Mode       | `bind_host`                | `allowed_hosts`   | `relay_url` | Reachable from                                 |
| ---------- | -------------------------- | ----------------- | ----------- | ---------------------------------------------- |
| Local      | `127.0.0.1` or `localhost` | must be empty     | must be `None` | this machine only                          |
| SelfHosted | any non-loopback host      | must be non-empty | not checked | the hosts the owner named                     |
| Hosted     | `127.0.0.1` or `localhost` | not checked       | must be `Some` | remote devices through the relay, never a port |

Hosted does **not** check `allowed_hosts`: the API never listens off-host, so an
allow-list there would describe a socket that does not exist.

### The types

```rust,ignore
pub enum RunMode { Local, SelfHosted, Hosted }   // serde snake_case

pub struct RunModeConfig {
    pub mode: RunMode,
    pub bind_host: String,
    pub allowed_hosts: Vec<String>,
    pub relay_url: Option<String>,
}

impl RunModeConfig {
    pub fn for_mode(mode: RunMode) -> Self;
    pub fn validate(&self) -> Result<(), RunModeError>;
    pub fn is_loopback_only(&self) -> bool;
    pub fn requires_pairing(&self) -> bool;
}

pub struct PhonePairing {
    pub device_id: String,
    pub secret: String,
    pub created_at: u64,
    pub revoked: bool,
}

pub trait PairingStore {
    fn create(&mut self, device_id: &str, secret: &str, created_at: u64)
        -> Result<PhonePairing, RunModeError>;
    fn list(&self) -> Vec<PhonePairing>;
    fn revoke(&mut self, device_id: &str) -> Result<PhonePairing, RunModeError>;
    fn is_revoked(&self, device_id: &str) -> Result<bool, RunModeError>;
    fn active(&self) -> Vec<PhonePairing>;
}

pub struct InMemoryPairingStore { /* … */ }
```

### `for_mode` returns a starting point, not an approved config

`for_mode(Local)` is valid as returned. The other two are deliberately **not**:

- `for_mode(SelfHosted)` binds `0.0.0.0` and carries an empty allow-list, so
  `validate()` returns `AllowedHostsRequired`. A missing allow-list must stop the
  daemon from coming up on an open port; it must not be filled in with a wildcard.
- `for_mode(Hosted)` binds loopback and carries no relay, so `validate()` returns
  `RelayUrlRequired`.

That asymmetry is the whole point: the safe default is the one that refuses to
start.

### Bind rules and the errors that name them

| Mode       | Rejected configuration                       | Error                                     |
| ---------- | -------------------------------------------- | ----------------------------------------- |
| every mode | `bind_host` blank or whitespace              | `BlankBindHost { mode }`                  |
| Local      | `bind_host` not `127.0.0.1`/`localhost`      | `InvalidBindHost { mode, host }`          |
| Local      | any `allowed_hosts` entry                    | `AllowedHostsNotPermitted { mode, count }` |
| Local      | any `relay_url`                              | `RelayUrlNotPermitted { mode }`           |
| SelfHosted | `bind_host` is `127.0.0.1`/`localhost`       | `InvalidBindHost { mode, host }`          |
| SelfHosted | empty `allowed_hosts`                        | `AllowedHostsRequired { mode }`           |
| SelfHosted | an allow-list entry with whitespace or `/`   | `InvalidAllowedHost { host }`             |
| Hosted     | `bind_host` not `127.0.0.1`/`localhost`      | `InvalidBindHost { mode, host }`          |
| Hosted     | `relay_url` missing or blank                 | `RelayUrlRequired { mode }`               |

`is_loopback_only()` answers from the bind host alone: `true` for Local and
Hosted, `false` for SelfHosted. Hosted is `true` because its API binds loopback
and remote devices arrive through the relay — whether a relay is reachable is a
different question, and nothing in the module checks it.

`127.0.0.1` and `localhost` are the only accepted loopback spellings, compared
after trimming and case-insensitively for `localhost`. `::1` is deliberately
absent: the daemon binds IPv4 and reports one address, so accepting a v6 literal
would validate a config nothing can bind.

### Phone pairing

Pairing is the M6 device flow — QR code, one-time secret, E2E channel — and it is
**required in every mode**: a phone is a remote device even when the daemon is
local. The crypto lives in `warsha-remote` and is described in
[Security Model](security.md); this module owns the lifecycle around it.

1. The daemon mints a device id and a one-time secret (**M6's job**, not this
   module's — no generator lives here).
2. `PairingStore::create(device_id, secret, created_at)` records it. A blank id
   or secret is `BlankDeviceId` / `BlankSecret`.
3. The phone scans the QR, completes the handshake with the secret, and acts as
   that device.
4. `list()` returns every record, active and revoked, in creation order;
   `active()` filters to the devices still allowed to act.
5. `revoke(device_id)` marks the record revoked and keeps it, so "was this device
   ever paired, and when was it cut off" stays answerable. Revoking twice is not
   an error — two taps on the same button must both succeed.
6. `is_revoked(device_id)` returns `Ok(true)`/`Ok(false)` for a known device and
   `PairingNotFound` for an unknown one, so "no record" can never read as
   "active".

A device id with an existing record is refused with `DeviceAlreadyPaired`, **even
after revocation**. Re-pairing is a fresh device id the owner can see, not a
silent resurrection of a revoked one.

A `PhonePairing` has a hand-written `Debug` that prints `secret: "<redacted>"`, so
a stray `tracing::debug!("{:?}", pairing)` cannot put the secret in a log. The
field is still serialised — the pairing channel has to hand it to the device.

### The badge

`apps/desktop/src/components/RunModeBadge.tsx` renders the current mode as an icon
plus a coloured pill: green for Local, amber for Self-hosted, and the Warsha accent
(`#FFD60A` on `#0E0E0E`) for Hosted. The tags are the serde tags
(`local`/`self_hosted`/`hosted`), and `loopbackOnly()` is that module's
`is_loopback_only` rule, so the badge and the config cannot disagree about which
mode exposes a socket. It is RTL-safe: it takes its `dir` from the locale and uses
logical padding (`paddingInline`), with `unicode-bidi: isolate` around the label.

### What is not here yet

- **Nothing binds a socket.** `bind_host` is data; there is no listener, no peer
  check and no allow-list middleware. The M1 daemon and its JSON-RPC surface are
  unchanged, and no run mode is read at startup.
- **No relay client.** `relay_url` is a string this module validates and nothing
  dials; the E2E transport is M6's `warsha-relay`.
- **No persistence.** `PairingStore` is implemented only in memory. The `devices`
  table and its migrations in `warsha-store` are where a durable implementation
  belongs, and that crate is outside this change set — so a restart forgets every
  pairing.
- **No secret generator.** M6's QR flow decides the secret's format and length;
  this module only refuses a blank one, so the two cannot disagree.
- **The badge is not mounted.** It ships with its tests; no screen reads a run
  mode yet, because nothing in the daemon reports one.

The rule the three modes share: a config that could expose the API by accident is
refused, not corrected.
