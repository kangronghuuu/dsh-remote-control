# dsh-remote-control-plugin

## Install

```bash
pnpm add dsh-remote-control-plugin
```

Add `dsh-remote-control-plugin` to `dsh.profile.bundles` in
`$DSH_HOME/profiles/<profile>/package.json`, run `pnpm install`, then restart DSH.
Full instructions, including offline installs and version parity: [INSTALL.md](INSTALL.md).

Control other DSH desktops from the one you are using.

Two surfaces share one Host plugin:

- **Devices panel** (Web GUI) — discovers other DSH desktops on the same network, asks the
  target for access once, then lists that device's sessions and lets you read the live
  transcript, send prompts, and stop a turn.
- **Browser page** (phone / any browser) — the same control surface as a small standalone
  page, unlocked with a pairing code. Useful when the other end is a phone rather than a DSH
  desktop.

Both drive `ctx.sessionController` in-process, so neither depends on the GUI's boot payload.

## How device trust works

1. Each Host generates a device identity once: an Ed25519 signing key and an X25519 agreement
   key, stored as a credential-store record (a `0600` file only as a fallback). The fingerprint
   is derived from the public key.
2. Hosts announce themselves on UDP `discoveryPort` with device id, display name, and account id
   (when signed in).
3. To control a peer, this Host sends `POST /peer/hello` carrying its public key, fingerprint,
   agreement key and a signed ephemeral key. The **target** shows a pending request in its own
   Devices panel; nothing is granted until a person there presses **Allow** and the six-digit
   short authentication string (SAS, derived from both fingerprints and the invite nonce) matches
   on both screens.
4. On approval the peer keys are pinned. Later calls carry an **Ed25519 signature** over method,
   path, timestamp and a fresh nonce, with a five-minute skew window and a replay cache. The
   legacy shared-secret HMAC is retired as soon as a key is pinned, because the approval response
   that carried that secret crossed the relay in plaintext.
5. Each approval records its scope list (`sessions:list`, `transcript:read`, `prompt:send`,
   `stop`, `config:read`, `config:write`, `files:write`), the fingerprint, the agreement key and
   the relay used. Scope edits and **Revoke** take effect immediately; revoking also drops the
   cached keys.
6. Approvals persist as credential-store grants; deleting the record revokes every device.

There is deliberately no "same account implies trust" shortcut: two devices holding grants for
the same account share no secret, so account id alone cannot authenticate a peer. The panel shows
the account id of each candidate and flags a different account, but a person approves.

## Across networks (relay)

LAN discovery only reaches one subnet. Devices on different networks meet through a relay, and
there are two ways to get one.

**Create it on a device.** In **Devices → Relay**, press **Create relay here**. That Host serves
the relay on its own listener and shows a ready-to-paste invite — one line holding the URL and
the workspace key. Paste it into the other device's Relay panel.

This only reaches other networks if that device is reachable there: the same LAN, a forwarded
port, a VPN address, or a configured `publicUrl`. The invite carries the address the panel can
see, so forward that port (or set `publicUrl`) before sharing it.

**Or run a relay on a machine that is always reachable:**

```sh
PORT=8787 node relay/server.js
```

Host it on a VPS, NAS, or any always-on machine, put it behind TLS or a VPN, and paste
`http://host:8787 <workspace key>` into every device.

Either way the workspace key never leaves the devices: the relay only receives its SHA-256 as a
group id. It forwards opaque `/peer/*` calls, and after pairing every message is sealed end to
end, so a compromised relay sees ciphertext and can only drop or delay traffic. Group membership
alone grants nothing — the target still requires the one-time approval before any session call is
accepted. Treat the relay as private: whoever holds the group id can join the group and *request*
access.

### Encryption

The envelope names its cipher (a byte in the nonce): ChaCha20-Poly1305 when the runtime offers it, AES-256-GCM otherwise, so a build without ChaCha still interoperates.

Paired devices agree a session key with X25519 (ephemeral mixed with static when both sides
completed the pairing handshake) → HKDF-SHA256 → ChaCha20-Poly1305. The relay envelope seals every
message; on a direct LAN lane the request body and reply are sealed with a separate per-transport
key, and transcript frames with another. Plaintext exists only during bootstrap: the `hello`
request and the approval response that carries the peer's public keys.

A peer that pinned an identity but has no agreement key is **refused** over the relay
(`plaintext-refused`) rather than silently downgraded; `allowPlaintextFallback: true` opts out.
Peers approved before identity keys existed keep the legacy HMAC path until they are re-approved.

### Lane ladder

Calls are attempted in order, each with its own budget: punched P2P (`p2pTimeoutMs`) → direct LAN
(`directTimeoutMs`) → relay. A blocked direct lane is parked per peer for `routeBlockMs` and then
retried as soon as fresh discovery evidence arrives. Latency-sensitive reads (`sessions`, session
config) race the relay against the direct lane so only the first call after a network change pays
a penalty; writes stay strictly ordered so a prompt can never run twice. `/state` reports `lane`,
`transport`, `timing` and `blocked` per peer.

## Run it as a service (0.5.0)

Turn reachability on once instead of recreating a tunnel each session. The plugin keeps identity and
pairing; the service layer only keeps the host reachable.

```yaml
service:
  enabled: true
  provider: auto            # auto | relay | tunnel | lan-only
  relayUrl: ''              # explicit relay (https recommended)
  publicUrl: ''             # externally reachable base URL
  tunnel:
    kind: cloudflared       # cloudflared | none
    binary: ''              # path; CLOUDFLARED_PATH env fallback
    tokenFile: ''           # named tunnel token (stable hostname)
    urlPattern: ''          # override the quick-tunnel URL regex
  autoReconnect: true
  healthIntervalMs: 30000
  advertise: true
```

Provider order: configured `relayUrl` → named tunnel (`tokenFile`) → quick tunnel → `publicUrl`
health check → LAN only.

**First-run setup.** The first time the Devices panel opens, a setup card asks once how other devices
should reach this Host: **LAN only**, **Host a relay here**, **Quick tunnel**, or **Join a relay**.
Choosing Quick tunnel performs the verified `cloudflared` download and starts the service in one
step; choosing a relay creates/joins it immediately. The answer is stored in
`$DSH_HOME/remote-control.json` (`setup`) and is re-applied on every start, so the service (and the
dependency it installed) survives restarts. **Skip** keeps the defaults and asks again on the next
panel open.

**Tunnel binary (verified download).** The plugin never downloads silently. When the tunnel provider
is selected and `cloudflared` is missing, the Service card offers **Download & verify**: it fetches the
version pinned in `host/tunnel-provision.js` (currently **2026.11.0**) from the official Cloudflare
GitHub release, verifies the SHA-256 pinned per platform (GitHub's server-computed asset digest),
installs it under `$DSH_HOME/bin` with a provenance file, and only then starts the tunnel. The action
requires a click and a `consent: true` request; a checksum mismatch deletes the download and leaves
the old binary untouched. `service.tunnel.provision` accepts `verified-download` (default),
`prompt` (guidance only) or `manual` (never download, use `tunnel.binary`/`CLOUDFLARED_PATH`/
PATH).

The Devices panel shows a **Service** card: provider, endpoint, health, uptime, last error, Start/Stop
and a QR of the endpoint. `GET /remote-control/api/service` and
`POST .../service/start|stop` are the console equivalents; `/state.service` carries the same
snapshot.

Phase 1 (this release): quick/named tunnel supervisor, service card, health/backoff, interface
change detection. Phase 2 adds URL-based pairing over `https` and relay re-registration on network
change; Phase 3 generates launchd/Task-Scheduler/systemd units from the panel.

## Configuration

Defaults work on a LAN. Override the row in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: remote-control
  name: 'dsh-remote-control-plugin'
  config:
    host: 0.0.0.0            # any interface (default); use one LAN IP to narrow exposure
    port: 57330              # browser page + peer API
    discovery: true
    discoveryPort: 57331     # UDP discovery
    relayUrl: ''             # e.g. https://relay.example.com for cross-network control
    relayKey: ''             # shared workspace key; required when relayUrl is set
    deviceName: Desk PC      # defaults to the OS hostname
    publicUrl: ''            # e.g. https://dsh.example.com for a tunnel/proxy
    trustedHosts: []         # extra accepted authorities for the browser page
    code: ''                 # fixed pairing code; empty = generated and persisted
    cookieDays: 30
    defaultCwd: ''
    tls: { certFile: '', keyFile: '' }
    directTimeoutMs: 1000        # budget for one direct LAN call before fallback
    streamConnectTimeoutMs: 2500 # budget for direct stream headers before fallback
    p2pTimeoutMs: 800            # budget for the punched lane per call
    routeBlockMs: 60000          # how long a failed lane stays parked
    punchPort: 57332             # UDP lane; also needs an inbound UDP firewall rule
    stunHost: stun.l.google.com  # or false to skip public mapping discovery
    allowPlaintextFallback: false # refuse rather than downgrade a pinned peer
```

The browser page and the peer API share the listener. When `host` is a wildcard, any IP literal
is accepted and domain-name Hosts are refused unless they appear in `publicUrl` or
`trustedHosts`; this blocks DNS-rebinding. Requests without a same-origin `Sec-Fetch-Site` must
come from loopback.

## Remembered selection and deep links

The panel remembers the last peer and session per browser and per Host (namespaced
localStorage), restores the reading position, and writes the selection into the URL hash
(#peer=<deviceId>&session=<sessionId>) so a link reopens the exact session. If the saved session
no longer exists, the list opens with a dismissible note instead of a blank pane. The standalone
browser page does the same for its session.

## Threat model / limits

- Approval is manual on purpose. A peer on the LAN can prompt for access; it cannot grant it.
  Compare the six-digit SAS on both screens, and check the fingerprint when in doubt.
- Prompts sent from a peer run with this Host's tools and permissions. Approve devices you
  control, and narrow scopes afterwards if a device only needs to read sessions.
- Transport is encrypted: sealed bodies/replies and transcript frames on a direct lane, an AEAD
  envelope over the relay. The relay sees ids, timing and ciphertext.
- Legacy fallback: a peer approved before identity keys existed has no pinned key and still uses
  the shared-secret HMAC in plaintext; a peer with a pinned identity but no agreement key is
  refused over the relay unless `allowPlaintextFallback: true`. Re-approve to upgrade both.
- Forward secrecy is per session: ephemeral keys live in memory and are re-established by the
  startup re-handshake, so a restart briefly degrades to static-static agreement.
- The construction is IK-shaped but **not Noise**: no protocol-name hash, no full handshake
  transcript.
- Uploads are capped at 25 MB per file and 100 MB per session, with a MIME allowlist; bytes only
  enter the Host attachment store, never a caller-supplied path.
- The pairing code protects the browser page only; it is printed at activation and stored in
  `$DSH_HOME/remote-control.json`.
- Approvals that arrive while no Devices panel is open stay pending for up to 10 minutes.

## Notifications (optional)

When an approval or a question is parked, the Host can notify you out of band, so you can answer
from a phone lock screen instead of opening the page.

Configure it in the Host's own settings file — `$DSH_HOME/remote-control-settings.json` — and never
in the profile patch layer. That file is local, git-ignored, and the only place credentials belong.
Every user configures **their own** mailbox or provider; nothing is shared with the maintainer.

```json
{
  "notify": {
    "kind": "smtp",
    "to": "you@example.com",
    "from": "you@example.com",
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 465,
    "smtpUser": "you@example.com",
    "smtpPass": "<your app password>",
    "baseUrl": "https://your-host.tailnet-name.ts.net",
    "events": ["approval", "question"]
  }
}
```

### Direct SMTP (`kind: "smtp"`)

Talks to the mailbox directly, with no relay service in between. Gmail needs an **app password**
(two-step verification on), not the account password. Port `465` uses implicit TLS; `587`
negotiates STARTTLS. `from` defaults to the SMTP user when omitted.

### Mailgun (`kind: "mailgun"`)

```json
{ "kind": "mailgun", "to": "you@example.com", "from": "postmaster@mg.example.com",
  "domain": "mg.example.com", "apiKey": "<private API key or sending key>",
  "apiUrl": "https://api.mailgun.net", "baseUrl": "https://your-host.tailnet-name.ts.net" }
```

Use the private API key or a domain sending key; a public validation key does not authenticate.
Sandbox domains only deliver to recipients authorised in the Mailgun dashboard.

### Webhook (`kind: "webhook"`) and ntfy (`kind: "ntfy"`)

`webhook` POSTs a JSON payload to `url`, optionally with an `Authorization: Bearer <token>`.
`ntfy` publishes a JSON message to the topic in `topic` (or the last path segment of `url`) and
renders the action links as buttons in the ntfy app.

### Security notes

- Credentials belong only in the local settings file. Do not commit it, do not put it in a patch
  layer, and do not paste it into an issue or a screenshot.
- The action buttons are signed links bound to one request and one decision; they stop working as
  soon as that request is answered or withdrawn.
- `baseUrl` must be reachable from the device that opens the link — a tailnet name, a VPN address,
  or a public URL.
- The Host reports only whether a secret is configured (`hasKey` / `hasPass`), never its value, and
  never logs the config.
- Delivery targets come exclusively from this local file, never from a request, so the plugin
  cannot be turned into a relay for someone else's traffic.
