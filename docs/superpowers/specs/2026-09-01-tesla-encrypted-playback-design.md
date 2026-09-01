# Design: Encrypted TeslaCam playback (Tesla account key fetch + on-the-fly decryption)

Date: 2026-09-01
Status: Approved (chat), pending spec review

## Problem

Tesla firmware 2026.20+ can encrypt Dashcam/Sentry clips (eCryptfs-style format).
TeslaCamViewer currently serves these files raw; they do not play. We need to:

1. Let the user log into their Tesla account (once) and fetch per-file encryption
   keys (FEKs) from Tesla.
2. Store the Tesla token in the browser's localStorage (user decision) and the FEKs
   server-side next to the footage.
3. Decrypt encrypted clips on the fly for playback, with HTTP Range support.
   Unencrypted files must keep playing exactly as today.

Reference implementation: [Te_FITI tesla_dashcam_decryptor](https://github.com/umstandsheini/Te_FITI/tree/main/tesla_dashcam_decryptor)
(Home Assistant add-on, Python). Crypto and API details below are taken from it.

## File format (eCryptfs clip)

- Fixed 8192-byte header, no encrypted data inside it.
- Header validation (big-endian):
  - offset 0, 8 bytes: plaintext size; must be ≤ `len(data) - 8192`
  - offset 8, u32 magic1; offset 12, u32 magic2; `magic1 XOR magic2 == 0x3C81B7F5`
  - offset 16, u32 version/flags == `0x03000002`
  - offset 20, u32 page size == `4096`
  - offset 24, u16 extent count == `2`
  - file length ≥ 8192 and a multiple of 4096
- Wrapped-key section at offset 4096 (this is the literal payload sent to Tesla):
  - `key_id`: u32 BE
  - `public_key`: 65 bytes, first byte must be `0x04` (uncompressed EC point)
  - `vin`: 17 ASCII bytes (rejected if starts with `\x00`)
  - `timestamp`: u64 BE
  - `wrapped_key`: 44 bytes (`12 + 16 + 16`)
- Ciphertext: everything from offset 8192 to EOF, encrypted as independent
  4096-byte pages.

## Decryption algorithm

- AES-128-CBC, 16-byte FEK, 16-byte IVs, one CBC chain per 4096-byte page
  (pages are independently decryptable).
- Root IV = `MD5(FEK)` (first 16 bytes).
- Page IV = `MD5(root_iv(16 bytes) || ascii(page_number) zero-padded to a
  32-byte buffer)[:16]`, page numbers starting at 0.
- After decrypting all pages, truncate the output to the plaintext size stored at
  header offset 0.

## Key fetching (Tesla API)

- Auth: OAuth 2.0 Authorization Code + PKCE (S256) against
  `https://auth.tesla.com/oauth2/v3/authorize` and `/token`.
  `client_id=dashcam`, `redirect_uri=https://dashcam.tesla.com/callback` (fixed,
  cannot be changed), scopes `openid profile email offline_access`.
- FEK endpoint: `POST https://dashcam.tesla.com/api/1/decrypt/batch`,
  `Authorization: Bearer <access_token>`, batches of at most 30 items:
  `{"items": [{"id", "vin", "key_id", "timestamp", "wrapped_key" (b64),
  "public_key" (b64)}]}`
  → `{"results": [{"id", "key"}]}` (`key` = base64 FEK; empty means no key
  returned). Response parser must also accept a bare list of `{id, key}` and a
  flat `{id: key}` mapping (reference normalizes all three).
- Known risk: `dashcam.tesla.com` is behind Akamai and may answer 403/challenge to
  non-browser calls. Mitigation for now: browser-like `User-Agent`, clear error
  surfaced to the UI. A bookmarklet fallback is explicitly out of scope for this
  iteration.

## Architecture

### Backend (Spring Boot 4 / Kotlin)

New package `dev.teslacam.encrypt`:

- `EcryptfsHeader` — data class + parser + validator for the header described
  above; produces the wrapped-key item (base64 fields) and `plaintextSize`.
- `EncryptionDetector` — header sniff + in-memory cache (file path → header or
  "plain"); reads at most 8192 bytes per file, once per scan.
- `PageDecryptor` — AES-128-CBC page decryption per the algorithm above; given
  FEK + page number, decrypt one page. No full-file buffering.
- `DecryptingMediaResource` / manual Range handling in the media path — serves a
  decrypted view of an encrypted file with correct 206 semantics: for a requested
  plaintext byte range, seek to `8192 + (offset / 4096) * 4096`, decrypt forward
  page-by-page, trim to the range. Content-Length = plaintext size.
- `TeslaKeyStore` — JSON file `.teslacam_keys.json` in `teslacam.root`
  (volume-mounted, survives restarts). Map keyed by `"<vin>:<key_id>:<timestamp>"`
  → base64 FEK. Thread-safe load/save.
- `TeslaKeyClient` — batches items (≤30), calls the batch endpoint with the
  Bearer token supplied by the frontend, normalizes the three response shapes,
  returns `Map<id, FEK>`; typed errors: `AkamaiChallenge` (403), `AuthError`
  (401), `ApiError`.
- `TeslaAuthClient` — exchanges OAuth `code` + PKCE verifier for tokens at
  `auth.tesla.com/oauth2/v3/token` (form POST); performs refresh grant (reuse old
  refresh token if response omits one). Backend does not persist tokens — they
  live in the browser per the user's decision.

### API changes

- `GET /api/events/{category}` / `.../{folder}`: segment DTOs gain
  `encrypted: boolean`, and for encrypted files the wrapped-key fields
  (`keyId`, `vin`, `timestamp`, `wrappedKey` b64, `publicKey` b64) so the
  frontend can build batch items without another round trip.
- `POST /api/keys/fetch` — body: `{ items: [wrapped-key items with id] }`;
  header `Authorization: Bearer <tesla access token from localStorage>`.
  `id` is the file path relative to `teslacam.root` (echoed back by Tesla and
  used only for response correlation; the FEK store key is derived from the
  item's own `vin:key_id:timestamp`). Returns per-item status (`fetched` /
  `no_key` / `failed`) + counts.
- `POST /api/tesla/token` — `{ code, verifier }` → `{ accessToken, refreshToken,
  expiresIn }` (or typed error).
- `POST /api/tesla/refresh` — `{ refreshToken }` → fresh tokens.
- `GET /media/...` — unchanged URL; encrypted files transparently decrypted.
  `thumb.png` files inside encrypted event folders are expected to be encrypted
  too (same format) — same path handles them.

### Frontend (React / TS / MUI)

- `teslaAuth.ts` — builds authorize URL with PKCE (verifier in localStorage),
  opens popup, parses pasted callback URL (`code`, `state`), token exchange +
  refresh via the new endpoints, stores access + refresh token in localStorage.
- `keys.ts` — given a segment's wrapped-key item, checks nothing client-side
  (store is server-side); calls `POST /api/keys/fetch` with the Bearer token.
- Playback integration — when the opened event contains encrypted segments and
  the first playback attempt fails or keys are known missing: gather distinct
  wrapped-key items → `POST /api/keys/fetch` → retry. Errors mapped to UI:
  not logged in → login prompt; Akamai 403 / other → error toast explaining the
  fallback limitation.
- Event list: lock icon on encrypted events; header shows Tesla login status
  (logged in / logged out) and cached-key count.

## Error handling

- Missing FEK at playback: frontend triggers key fetch flow; if still missing,
  segment shows "key unavailable" state, other cameras keep playing.
- Not logged in / expired refresh token: login prompt; stored tokens cleared on
  hard auth failure.
- Akamai 403: explicit message that server-side key fetch was blocked.
- Corrupt/unparseable encrypted header: serve a clear 415-style error for that
  file, never crash the scan; scanner logs and continues (reference lesson: one
  bad file must not stall the library).

## Testing

- Header parser: synthetic encrypted file builder (mirrors reference test
  approach) — valid header, each invalid-field case rejected.
- PageDecryptor: round-trip encrypt→decrypt over multi-page synthetic file;
  deterministic-IV property (same page decrypts identically out of order).
- TeslaKeyStore: persist/load round trip, concurrent saves, key format.
- TeslaKeyClient: batching (splits >30), the three response shapes, 403/401
  mapping (mocked server, e.g. MockWebServer or Spring MockRestServiceServer).
- Media Range tests: plain file 206 unchanged; encrypted file full GET byte-
  identical to reference decryption; random 206 ranges (page boundaries,
  mid-page, tail) correct.
- Frontend: vitest for PKCE URL builder, callback-URL parser, key-fetch flow
  state machine.

## Out of scope

- Bookmarklet/manual key import fallback.
- Writing decrypted copies to disk or key-embedding into MP4s.
- Fleet API / official Tesla third-party OAuth client (client_id `owner-api`):
  we intentionally mirror the reference's `dashcam` client.