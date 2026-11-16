# Install on another desktop

The plugin is self-contained: `index.js`, `client.js`, `host/`, `web/`, `locale/`, `icon.svg`.
Nothing here refers to the machine it was built on.

## 1. Get the package onto that machine

The plugin is self-contained: `index.js`, `client.js`, `host/`, `web/`, `locale/`, `icon.svg`.
Nothing here refers to the machine it was built on. Three ways to ship it, pick one:

**A. Private repository (recommended â€” versions stay comparable)**

```bash
git clone git@github.com:kangronghuuu/dsh-remote-control.git ~/dsh-remote-control
```

Update later with `git -C ~/dsh-remote-control pull`, then reinstall the profile dependency.

**B. Tarball (no git, no registry)**

```bash
npm pack                       # on the source machine -> local-dsh-remote-control-0.6.0.tgz
pnpm add /path/to/local-dsh-remote-control-0.6.0.tgz
```

**C. Git dependency inside the profile**

```json
"dsh-remote-control-plugin": "github:kangronghuuu/dsh-remote-control#v0.6.0"
```

pnpm needs credentials for a private repo: either an SSH key on the machine, or
`git config --global url."https://<token>@github.com/".insteadOf "https://github.com/"`.

## 2. Install it into that machine's profile

`dsh plugin add` forwards to `pnpm`, which is not on `PATH` outside the app, so use the app's own
Plugin Manager instead:

1. Open DSH on that desktop.
2. Start a session and send:

   > Install the DSH plugin bundle at `C:\Users\<you>\dsh-remote-control` with plugin_manager, then tell me when it is applied.

3. Restart DSH. A **Devices** icon appears in the sidebar.

If you prefer doing it by hand, add the dependency and the bundle entry to
`$DSH_HOME/profiles/<profile>/package.json`:

```json
{
  "dependencies": {
    "dsh-remote-control-plugin": "link:C:/Users/<you>/dsh-remote-control"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-remote-control-plugin"]
    }
  }
}
```

For a tarball install use the absolute path instead of `link:`:

```json
"dsh-remote-control-plugin": "file:C:/Users/<you>/local-dsh-remote-control-0.6.0.tgz"
```

then run `pnpm install` in that profile directory and restart DSH.

### Version parity

Both machines must run the same version. The handshake carries `wire` (see
`host/crypto.js: WIRE_VERSION`); a peer that speaks a different version is refused with
`version-mismatch` naming both numbers, instead of failing later with an undecryptable
envelope. Check the installed version with:

```bash
node -p "require('./package.json').version"
```

## 3. Connect the two machines

Both machines run the same version. Pick the one with a reachable address (same LAN, VPN, or a
forwarded port):

1. On that machine: **Devices â†’ Relay â†’ Create relay here**, then **Copy** the invite.
2. On the other machine: **Devices â†’ Relay**, paste the invite into the URL field, **Connect**.
3. Either machine: **Request** next to the peer, then **Allow** on the target.

No relay reachable? Run one anywhere both machines can reach:

```sh
PORT=8787 node relay/server.js
```

and paste `http://<host>:8787 <workspace key>` into both panels.

## Pairing check (SAS)

When a device asks for access, the target's Devices panel shows a six-digit SAS next to the
fingerprint, and the requesting device shows the same six digits. They match only when both sides
pinned the same keys for the same invite. If they differ, press **Deny** and pair again.

## Direct P2P and the firewall

Same-LAN devices connect directly. Across networks the plugin tries a punched UDP lane before the
relay:

- allow **inbound UDP** for `punchPort` (default `57332`) in the OS firewall â€” the installer's
  rule covers TCP `57330` only;
- `stunHost` (default `stun.l.google.com`) discovers the public mapping; set it to `false` to skip;
- `/state` reports `lane` (`lan` / `p2p` / `relay`), `transport`, `timing` and `blocked` per peer.

If the punch fails, calls fall back to the relay automatically; the first blocked call is the only
one that pays a timeout.

## Files and session control

Attach files in the Devices chat with **Attach** or drag-and-drop: uploads are chunked with
progress, then appear as attachments in the transcript on both devices (25 MB per file, 100 MB
per session, MIME allowlist). The remote device's model, permission preset and plan mode are
editable from the chat header once the peer is approved.

## Service mode (optional)

To keep this Host reachable without a manual tunnel each session:

1. On first open of the Devices panel, answer the **Set up remote access** card once (LAN only,
   host/join a relay, or quick tunnel). The choice is persisted and re-applied on restart.
2. If `cloudflared` is missing, the **Service** card shows **Download & verify v2026.11.0**: one
   click downloads the pinned Cloudflare release, checks the pinned SHA-256, and installs it under
   `$DSH_HOME/bin`. Alternative installs: put it on PATH, set `CLOUDFLARED_PATH`, set
   `service.tunnel.binary`, or set `service.tunnel.provision: manual` for air-gapped fleets.
3. For a stable hostname use a named tunnel token file (`service.tunnel.tokenFile`) and set
   `service.publicUrl`; a quick tunnel gets a random `*.trycloudflare.com` URL that changes on
   restart.
4. The card shows health, uptime and the last error; tunnel crashes restart with backoff and the
   log ring keeps the last lines.

Note: URL-based pairing over the tunnel is Phase 2; today pair through the relay or LAN and use the
service endpoint for reachability diagnostics.

## Notes

- The account label is cosmetic; trust comes from the one-time **Allow** on the target device.
- Approvals are credential-store grants under `remote-control/peers` (the fallback file is
  `$DSH_HOME/remote-control-peers.json`). Revoke a device from the panel, or delete the record to
  revoke every peer.
- The relay and the control API share one port (default `57330`), so a single forwarded port is
  enough.
- Restart both machines after installing a new version. Pairings survive restarts; the first call
  after a restart re-establishes forward secrecy.

