# Security policy

This plugin opens a listener on your machine and can drive DSH sessions on paired
devices, so a vulnerability here is a serious one. Please report it privately.

## Reporting

Use **GitHub's private vulnerability reporting**: open the repository's
**Security** tab and choose **Report a vulnerability**. That opens a private
advisory only the maintainer can read, and it keeps the report out of the
public issue tracker until a fix is released.

If the report is not sensitive (for example, a documentation correction or a
non-exploitable crash), a regular issue is fine:
https://github.com/kangronghuuu/dsh-remote-control/issues

Do not open a public issue for an exploitable problem, paste working exploits
into chat, or attach your pairing code, device secret, identity keys, or
notification credentials. If a secret may have leaked, rotate it first
(**Settings → Pairing → Rotate**) and then report.

## Scope

In scope: pairing and approval, the peer transport (LAN / tailnet / relay /
tunnel), end-to-end encryption and the sealed lane, the console API, uploads,
and the phone page.

Out of scope: issues that need a malicious local administrator, DSH itself,
third-party relays or tunnels you configured, and social engineering.

## What the plugin promises

- Every peer call is authenticated and, once a key exists, encrypted; a pinned
  peer never falls back to plaintext.
- Secrets (pairing code, device secret, identity keys, SMTP password) stay in
  the local state file; they are never written into the plugin config, the
  transcript, or diagnostics.
- The console API is reachable from the paired browser only; a request without
  a valid session is refused.
