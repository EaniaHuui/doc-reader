# Doc Reader API v1

Base path: `/api/v1`

- JSON: `snake_case`
- Timestamps: ISO 8601 UTC (`...Z`)
- Auth: `Authorization: Bearer <access_token>`
- Errors: `{ "error": { "code": "machine_code", "message": "中文用户提示" } }`
- Document/image responses: `Cache-Control: no-store`
- Paths: root-relative POSIX; never server absolute paths or `..`

## Status codes

| Code | Meaning |
|------|---------|
| 401 | Missing/expired/invalid auth |
| 403 | Authenticated but outside allowed root / symlink escape |
| 404 | Missing resource |
| 409 | Version conflict or path exists |
| 422 | Valid JSON that fails validation |

---

## Auth and pairing

### `GET /health`

```json
{ "status": "ok", "version": "2.0.0", "https_required": true }
```

### `POST /auth/login`

Request:

```json
{ "username": "zhuhui", "password": "..." }
```

Response:

```json
{
  "access_token": "eyJ...",
  "expires_at": "2026-07-21T12:00:00Z",
  "user": { "id": "user_zhuhui", "name": "zhuhui" }
}
```

### `GET /auth/me`

Returns current user and server metadata.

### `POST /auth/pairing-sessions`

Requires browser session or bearer token. Creates a one-time 60s pairing session.

Response:

```json
{
  "pairing_session_id": "abc...",
  "expires_at": "2026-07-20T12:00:60Z",
  "expires_in_seconds": 60,
  "protocol_version": 1,
  "qr_payload": {
    "v": 1,
    "server_url": "https://doc.example.com",
    "pairing_session_id": "abc...",
    "secret": "one-time-secret"
  },
  "qr_data": "{\"v\":1,...}"
}
```

QR data contains only: HTTPS server URL, session id, one-time secret, protocol version. Never a password or long-lived token.

### `POST /auth/pairing/exchange`

Request: scanned payload (flat or nested under `payload`).

Response: same shape as login. Consumed/expired codes never succeed again.

### `POST /auth/logout`

Revokes the presented token (`jti`) when revocation is enabled.

---

## Bootstrap and home

### `GET /bootstrap`

```json
{
  "user": { "id": "...", "name": "..." },
  "server_name": "Doc Reader",
  "version": "2.0.0",
  "roots": [{ "root_id": "root_...", "name": "文档", "path": "" }],
  "supported_file_types": {
    "editable": ["markdown", "txt", "json"],
    "readable": ["markdown", "txt", "json", "image"],
    "image_extensions": [".png", ".jpg", "..."]
  },
  "features": { "search": true, "trash": true, "pairing": true, "fts": true }
}
```

### `GET /home`

```json
{
  "pinned": [{ "root_id": "...", "path": "a.md", "title": "a", "type": "markdown", "modified_at": "...", "size_bytes": 12, "pinned": true }],
  "recent": [ ... ]
}
```

### `PUT /documents/pin`

```json
{ "root_id": "...", "path": "a.md", "pinned": true }
```

### `POST /documents/opened`

```json
{ "root_id": "...", "path": "a.md" }
```

Updates recent order only (no reading position).

---

## Search and tree

### `GET /search?q=&cursor=&limit=`

```json
{
  "results": [
    {
      "document": { "root_id": "...", "path": "a.md", "title": "A", "type": "markdown", "modified_at": "...", "size_bytes": 1, "pinned": false },
      "snippet": "...«match»...",
      "title_match": true
    }
  ],
  "next_cursor": "20"
}
```

### `GET /tree?root_id=&path=`

Direct children only:

```json
{
  "root_id": "...",
  "path": "",
  "entries": [
    { "name": "notes", "path": "notes", "kind": "directory", "type": null, "modified_at": "...", "size_bytes": null },
    { "name": "a.md", "path": "a.md", "kind": "file", "type": "markdown", "modified_at": "...", "size_bytes": 120 }
  ]
}
```

---

## Read and write

### `GET /documents?root_id=&path=`

```json
{
  "document": {
    "root_id": "...",
    "path": "a.md",
    "title": "a",
    "type": "markdown",
    "modified_at": "...",
    "size_bytes": 12,
    "pinned": false,
    "raw_content": "# Title\n",
    "revision": "sha256...:size:mtime_ns:ino",
    "encoding": "utf-8"
  }
}
```

JSON may include `formatted_content`; `raw_content` remains the save value.

### `POST /documents`

```json
{ "root_id": "...", "path": "new.md", "type": "markdown", "raw_content": "" }
```

### `PUT /documents`

```json
{
  "root_id": "...",
  "path": "a.md",
  "raw_content": "...",
  "if_match_revision": "...",
  "force": false
}
```

On `409`:

```json
{
  "error": { "code": "revision_conflict", "message": "文档已被其他客户端修改" },
  "document": { "raw_content": "...", "revision": "...", "...": "..." }
}
```

### `POST /directories`

```json
{ "root_id": "...", "path": "folder/name" }
```

### `PATCH /entries/move`

```json
{ "root_id": "...", "from_path": "a.md", "to_path": "dir/a.md", "if_match_revision": "..." }
```

Rejects moving a directory into itself or a descendant.

### `DELETE /entries`

```json
{ "root_id": "...", "path": "a.md", "if_match_revision": "..." }
```

Moves to server-side trash (never hard-deletes via this endpoint).

---

## Trash and assets

### `GET /trash`

```json
{
  "entries": [
    {
      "id": "...",
      "root_id": "...",
      "original_path": "a.md",
      "kind": "file",
      "type": "markdown",
      "title": "a.md",
      "size_bytes": 12,
      "deleted_at": "...",
      "expires_at": "..."
    }
  ]
}
```

### `POST /trash/<id>/restore`

Optional body `{ "path": "alternate.md" }`. `409` if target exists.

### `DELETE /trash/<id>`

```json
{ "confirm": true }
```

### `GET /assets?root_id=&path=`

Streams a supported image with accurate content type and `Cache-Control: no-store`.

---

## Desktop-only helpers

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/render` | Markdown/TXT/JSON → HTML for desktop reading view |
| `GET/PUT /api/v1/admin/directories` | Configure document roots |
| `GET /api/v1/remote-image` | Proxy remote images for desktop markdown |
| `/api/share-links` | Read-only share links (not part of mobile contract) |

---

## Revisions

`revision = sha256(content):size:mtime_ns:inode`

Mutations require `if_match_revision` unless `force: true`.
