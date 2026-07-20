#!/usr/bin/env python3
"""Print a config.yaml users block with PBKDF2 hashes for plaintext accounts.

Does NOT write config.yaml (safe by default). Review output, then paste.

Usage:
  ./venv/bin/python scripts/migrate_password_hashes.py
  ./venv/bin/python scripts/migrate_password_hashes.py --config /path/to/config.yaml
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from reader.auth import hash_password  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description='Migrate plaintext passwords to PBKDF2 hashes')
    parser.add_argument(
        '--config',
        type=Path,
        default=ROOT / 'config.yaml',
        help='Path to config.yaml (default: repo config.yaml)',
    )
    args = parser.parse_args()

    if not args.config.exists():
        print(f'Config not found: {args.config}', file=sys.stderr)
        return 1

    cfg = yaml.safe_load(args.config.read_text(encoding='utf-8')) or {}
    auth = cfg.get('auth') or {}
    users = auth.get('users') or []
    if not users:
        print('No users under auth.users', file=sys.stderr)
        return 1

    print('# Paste under auth.users:  (hashed: true)')
    print('users:')
    for user in users:
        username = user.get('username')
        password = user.get('password')
        is_hashed = user.get('hashed', False)
        if not username or password is None:
            continue

        if is_hashed and str(password).startswith('pbkdf2_sha256$'):
            digest = password
            note = 'already pbkdf2'
        elif is_hashed:
            # Keep legacy sha256 / custom as-is
            digest = password
            note = 'kept as-is (hashed: true, non-pbkdf2)'
        else:
            digest = hash_password(str(password))
            note = 'migrated from plaintext'

        print(f'  - username: {username}')
        print(f'    password: "{digest}"')
        print('    hashed: true')
        print(f'    # {note}')

    print()
    print('# Remember: after pasting, restart the service.', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
