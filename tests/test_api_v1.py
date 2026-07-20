"""API v1 contract tests: auth, paths, trash, FTS, conflicts, cache headers."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Project root on path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


class ApiV1TestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls.tmp = Path(cls._tmpdir.name)
        cls.doc_root = cls.tmp / 'docs'
        cls.doc_root.mkdir()
        (cls.doc_root / 'hello.md').write_text('# Hello\n\nworld alpha unique_token_xyz\n', encoding='utf-8')
        (cls.doc_root / 'note.txt').write_text('plain text note\n', encoding='utf-8')
        (cls.doc_root / 'data.json').write_text('{"a": 1}\n', encoding='utf-8')
        (cls.doc_root / 'pic.png').write_bytes(
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01'
            b'\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00'
            b'\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N'
            b'\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        (cls.doc_root / 'subdir').mkdir()
        (cls.doc_root / 'subdir' / 'nested.md').write_text('# Nested\n', encoding='utf-8')

        # Outside root for symlink escape tests
        cls.outside = cls.tmp / 'outside.txt'
        cls.outside.write_text('secret\n', encoding='utf-8')

        cls.config_path = cls.tmp / 'config.yaml'
        cls.config_path.write_text(
            f'''
directories:
  - path: "{cls.doc_root}"
    name: TestDocs
server:
  host: 127.0.0.1
  port: 59999
  debug: true
  public_base_url: https://docs.example.test
auth:
  enabled: true
  jwt_secret: test-secret-key-for-unit-tests-only-32chars
  token_expiration_hours: 1
  users:
    - username: tester
      password: secret123
      hashed: false
features:
  search: true
  dark_mode: true
''',
            encoding='utf-8',
        )

        # Point storage at temp config/db before importing app
        os.environ['DOC_READER_TEST'] = '1'
        import reader.storage as storage
        import reader.db as db

        storage.CONFIG_PATH = cls.config_path
        storage.DIRECTORIES_FILE = cls.tmp / 'directories.json'
        storage.SHARE_LINKS_FILE = cls.tmp / 'share_links.json'
        storage._config = None
        storage.save_directories_config([
            {'name': 'TestDocs', 'path': str(cls.doc_root)},
        ])

        db.DATA_DIR = cls.tmp / 'data'
        db.DB_PATH = db.DATA_DIR / 'test.db'
        db.TRASH_DIR = db.DATA_DIR / 'trash'
        db._initialized = False
        if hasattr(db._local, 'conn'):
            try:
                db._local.conn.close()
            except Exception:
                pass
            db._local.conn = None

        # Import app after paths configured
        import importlib
        import app as app_module
        importlib.reload(app_module)
        cls.app = app_module.app
        cls.client = cls.app.test_client()

        # Ensure roots + index ready
        from reader.roots import sync_roots_from_config
        from reader.fts_index import rescan_all
        from reader.db import init_db
        init_db()
        sync_roots_from_config()
        rescan_all()

    @classmethod
    def tearDownClass(cls):
        cls._tmpdir.cleanup()

    def login(self):
        resp = self.client.post(
            '/api/v1/auth/login',
            json={'username': 'tester', 'password': 'secret123'},
        )
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        data = resp.get_json()
        self.assertIn('access_token', data)
        self.assertIn('expires_at', data)
        self.assertIn('user', data)
        return data['access_token']

    def auth_headers(self, token=None):
        if token is None:
            token = self.login()
        return {'Authorization': f'Bearer {token}'}

    def root_id(self, token=None):
        resp = self.client.get('/api/v1/bootstrap', headers=self.auth_headers(token))
        self.assertEqual(resp.status_code, 200)
        roots = resp.get_json()['roots']
        self.assertTrue(roots)
        return roots[0]['root_id']

    # --- Health / Auth ---

    def test_health(self):
        resp = self.client.get('/api/v1/health')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data.get('https_required'))
        self.assertIn('version', data)

    def test_auth_failure(self):
        resp = self.client.get('/api/v1/bootstrap')
        self.assertEqual(resp.status_code, 401)
        body = resp.get_json()
        self.assertIn('error', body)
        self.assertIn('code', body['error'])

        resp = self.client.post(
            '/api/v1/auth/login',
            json={'username': 'tester', 'password': 'wrong'},
        )
        self.assertEqual(resp.status_code, 401)

    def test_auth_me(self):
        token = self.login()
        resp = self.client.get('/api/v1/auth/me', headers=self.auth_headers(token))
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['user']['name'], 'tester')

    # --- Path security ---

    def test_traversal_rejected(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)
        for bad in ['../outside.txt', '/etc/passwd', 'subdir/../../outside.txt', 'a/../../b']:
            resp = self.client.get(
                f'/api/v1/documents?root_id={rid}&path={bad}',
                headers=headers,
            )
            self.assertIn(resp.status_code, (403, 422), bad)

    def test_symlink_escape_rejected(self):
        token = self.login()
        rid = self.root_id(token)
        link = self.doc_root / 'escape_link.md'
        if link.exists() or link.is_symlink():
            link.unlink()
        try:
            link.symlink_to(self.outside)
        except OSError:
            self.skipTest('symlink not supported')
        try:
            resp = self.client.get(
                f'/api/v1/documents?root_id={rid}&path=escape_link.md',
                headers=self.auth_headers(token),
            )
            # Either escape detection (403) or type/read failure — must not leak content
            if resp.status_code == 200:
                body = resp.get_json()
                content = (body.get('document') or {}).get('raw_content', '')
                self.assertNotIn('secret', content)
            else:
                self.assertIn(resp.status_code, (403, 404, 422))
        finally:
            if link.exists() or link.is_symlink():
                link.unlink()

    def test_root_containment(self):
        token = self.login()
        rid = self.root_id(token)
        resp = self.client.get(
            f'/api/v1/documents?root_id={rid}&path=hello.md',
            headers=self.auth_headers(token),
        )
        self.assertEqual(resp.status_code, 200)
        doc = resp.get_json()['document']
        self.assertIn('unique_token_xyz', doc['raw_content'])
        self.assertEqual(doc['path'], 'hello.md')
        self.assertNotIn(str(self.doc_root), doc['path'])

    # --- Pairing ---

    def test_pairing_one_time_exchange(self):
        token = self.login()
        headers = self.auth_headers(token)
        resp = self.client.post('/api/v1/auth/pairing-sessions', headers=headers)
        self.assertEqual(resp.status_code, 201)
        session = resp.get_json()
        self.assertIn('qr_payload', session)
        payload = session['qr_payload']
        self.assertNotIn('password', json.dumps(payload))
        self.assertNotIn(token, json.dumps(payload))

        # First exchange succeeds
        resp = self.client.post('/api/v1/auth/pairing/exchange', json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access_token', resp.get_json())

        # Second exchange fails
        resp = self.client.post('/api/v1/auth/pairing/exchange', json=payload)
        self.assertEqual(resp.status_code, 401)

    def test_pairing_expired(self):
        token = self.login()
        headers = self.auth_headers(token)
        from reader import pairing as pairing_mod
        old = pairing_mod.PAIRING_TTL_SECONDS
        pairing_mod.PAIRING_TTL_SECONDS = 0
        try:
            resp = self.client.post('/api/v1/auth/pairing-sessions', headers=headers)
            payload = resp.get_json()['qr_payload']
            time.sleep(0.05)
            resp = self.client.post('/api/v1/auth/pairing/exchange', json=payload)
            self.assertEqual(resp.status_code, 401)
        finally:
            pairing_mod.PAIRING_TTL_SECONDS = old

    # --- Documents / conflict ---

    def test_document_conflict(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)
        resp = self.client.get(
            f'/api/v1/documents?root_id={rid}&path=hello.md', headers=headers
        )
        doc = resp.get_json()['document']
        rev = doc['revision']

        # Stale write
        resp = self.client.put(
            '/api/v1/documents',
            headers=headers,
            json={
                'root_id': rid,
                'path': 'hello.md',
                'raw_content': 'stale\n',
                'if_match_revision': 'deadbeef:0:0:0',
            },
        )
        self.assertEqual(resp.status_code, 409)
        body = resp.get_json()
        self.assertIn('document', body)
        self.assertIn('raw_content', body['document'])

        # Valid write
        resp = self.client.put(
            '/api/v1/documents',
            headers=headers,
            json={
                'root_id': rid,
                'path': 'hello.md',
                'raw_content': '# Hello\n\nupdated unique_token_xyz\n',
                'if_match_revision': rev,
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotEqual(resp.get_json()['document']['revision'], rev)

    def test_cache_control_no_store(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)
        resp = self.client.get(
            f'/api/v1/documents?root_id={rid}&path=hello.md', headers=headers
        )
        self.assertEqual(resp.headers.get('Cache-Control'), 'no-store')

        resp = self.client.get(
            f'/api/v1/assets?root_id={rid}&path=pic.png', headers=headers
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get('Cache-Control'), 'no-store')

    # --- Trash ---

    def test_trash_restore(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)

        # create file
        resp = self.client.post(
            '/api/v1/documents',
            headers=headers,
            json={
                'root_id': rid,
                'path': 'to_trash.md',
                'type': 'markdown',
                'raw_content': '# trash me\n',
            },
        )
        self.assertEqual(resp.status_code, 201)

        resp = self.client.delete(
            '/api/v1/entries',
            headers=headers,
            json={'root_id': rid, 'path': 'to_trash.md'},
        )
        self.assertEqual(resp.status_code, 200)
        trash = resp.get_json()['trash']
        self.assertFalse((self.doc_root / 'to_trash.md').exists())

        # list trash
        resp = self.client.get('/api/v1/trash', headers=headers)
        self.assertEqual(resp.status_code, 200)
        ids = [e['id'] for e in resp.get_json()['entries']]
        self.assertIn(trash['id'], ids)

        # restore
        resp = self.client.post(
            f"/api/v1/trash/{trash['id']}/restore",
            headers=headers,
            json={},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue((self.doc_root / 'to_trash.md').exists())

        # permanent delete after re-trash
        resp = self.client.delete(
            '/api/v1/entries',
            headers=headers,
            json={'root_id': rid, 'path': 'to_trash.md'},
        )
        tid = resp.get_json()['trash']['id']
        resp = self.client.delete(
            f'/api/v1/trash/{tid}',
            headers=headers,
            json={'confirm': True},
        )
        self.assertEqual(resp.status_code, 200)

    # --- FTS ---

    def test_fts_updates_after_mutation(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)
        marker = f'fts_marker_{int(time.time())}'

        resp = self.client.post(
            '/api/v1/documents',
            headers=headers,
            json={
                'root_id': rid,
                'path': 'fts_doc.md',
                'type': 'markdown',
                'raw_content': f'# FTS\n\n{marker}\n',
            },
        )
        self.assertEqual(resp.status_code, 201)

        # Index is synchronous on create
        resp = self.client.get(
            f'/api/v1/search?q={marker}',
            headers=headers,
        )
        self.assertEqual(resp.status_code, 200)
        results = resp.get_json()['results']
        paths = [r['document']['path'] for r in results]
        self.assertIn('fts_doc.md', paths)

        # Delete and ensure gone from index
        self.client.delete(
            '/api/v1/entries',
            headers=headers,
            json={'root_id': rid, 'path': 'fts_doc.md'},
        )
        resp = self.client.get(f'/api/v1/search?q={marker}', headers=headers)
        paths = [r['document']['path'] for r in resp.get_json()['results']]
        self.assertNotIn('fts_doc.md', paths)

    def test_tree_lazy(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)
        resp = self.client.get(f'/api/v1/tree?root_id={rid}', headers=headers)
        self.assertEqual(resp.status_code, 200)
        entries = resp.get_json()['entries']
        names = {e['name'] for e in entries}
        self.assertIn('hello.md', names)
        self.assertIn('subdir', names)
        # nested not at top level
        self.assertNotIn('nested.md', names)

    def test_pin_and_home(self):
        token = self.login()
        rid = self.root_id(token)
        headers = self.auth_headers(token)
        resp = self.client.put(
            '/api/v1/documents/pin',
            headers=headers,
            json={'root_id': rid, 'path': 'hello.md', 'pinned': True},
        )
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get('/api/v1/home', headers=headers)
        pinned = resp.get_json()['pinned']
        self.assertTrue(any(p['path'] == 'hello.md' for p in pinned))


if __name__ == '__main__':
    unittest.main()
