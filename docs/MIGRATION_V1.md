# Migration to API v1 / SQLite metadata

## What changes

- All mobile/desktop JSON APIs move to `/api/v1`.
- Document paths become `{ root_id, path }` (root-relative POSIX). Absolute/`~/` paths are no longer used in the API.
- Deletes move files into server-side trash (`data/trash/`) with 30-day recovery.
- SQLite (`data/doc_reader.db`) stores FTS index, pins, recent docs, pairing sessions, trash metadata, and migration state.
- **Original documents stay on disk under configured roots.** They are never copied into a second application document store.

## Upgrade steps

1. Deploy new code (Flask app + static assets).
2. Ensure `config.yaml` / `directories.json` still list your document roots (same paths as before).
3. Start the server. On boot it will:
   - Create `data/` and `data/doc_reader.db` if missing
   - Import roots from `directories.json` / `config.yaml` into SQLite (`roots` table)
   - Build the FTS index in a background thread
4. Desktop Web client is updated in the same release; hard-refresh the browser.
5. Production must terminate TLS (nginx) and serve HTTPS only. Set `server.public_base_url` to the canonical HTTPS URL for pairing QR payloads.

## Rollback

1. Stop the new process.
2. Deploy the previous release.
3. Old endpoints (`/api/file`, `/api/directories`, …) return; desktop static assets from the old release are required.
4. SQLite `data/` and trash can remain on disk (harmless to the old release).
5. Files that were soft-deleted under the new release may still be under `data/trash/` — restore manually from there if needed before rolling back.

## Data notes

| Store | Location | Safe to delete? |
|-------|----------|-----------------|
| Documents | Configured roots | No |
| SQLite metadata | `data/doc_reader.db` | Yes (rebuilds FTS/pins/recent; loses pins/recent/pairing history) |
| Trash files | `data/trash/` | Only after expiry / user permanent delete |
| Share links | `share_links.json` | Desktop-only feature; unchanged format (absolute paths) |

## Auth tokens

JWT payload now includes `jti`, `sub`, and `name`. Old tokens without `jti` still decode until expiry; logout revocation only applies to tokens that carry `jti`.
