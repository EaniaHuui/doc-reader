#!/usr/bin/env python3
"""Generate a PBKDF2 password hash for config.yaml.

Usage:
  ./venv/bin/python scripts/hash_password.py
  ./venv/bin/python scripts/hash_password.py 'your-password'

Then put the output into config.yaml:

  users:
    - username: alice
      password: "pbkdf2_sha256$..."
      hashed: true
"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

# Allow running from repo root or scripts/
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from reader.auth import hash_password  # noqa: E402


def main() -> int:
    if len(sys.argv) > 1:
        password = sys.argv[1]
    else:
        password = getpass.getpass('Password: ')
        confirm = getpass.getpass('Confirm: ')
        if password != confirm:
            print('Passwords do not match.', file=sys.stderr)
            return 1

    if not password:
        print('Empty password.', file=sys.stderr)
        return 1

    print(hash_password(password))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
