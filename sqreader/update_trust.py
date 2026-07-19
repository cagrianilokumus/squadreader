"""The baked-in Ed25519 public key the agent trusts for signed updates.

Set this at RELEASE time, not in normal development:

  1. On an OFFLINE box, run:  python -m central.release gen-key --out signing_key.pem
  2. Keep signing_key.pem offline (it signs every offset pack / release).
  3. Paste the printed public key below, then cut the agent release.

An empty value means "no update trust anchor configured": signed-update
verification (update_sign.verify) then fails closed, so a misbuilt or untrusted
agent can never apply an offset pack or code release. That is the safe default —
a real deployment overrides it with a real key at build time.
"""
EMBEDDED_ED25519_PUBKEY_B64 = "XMNI8izp6GiwPsIQudZ4q1Z5LF3LXxs/uOdWLegyseU="
