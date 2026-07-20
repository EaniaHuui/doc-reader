"""Path helpers and permission checks against configured roots."""

from __future__ import annotations

from pathlib import Path

from .storage import load_directories_config


def expand_path(path) -> Path:
    return Path(path).expanduser().resolve()


def simplify_path(path) -> str:
    path_str = str(path)
    home = str(Path.home())
    if path_str.startswith(home):
        return path_str.replace(home, '~', 1)
    return path_str


def is_path_in_directories(target_path, directories=None) -> bool:
    """Check whether target_path lies under an allowed directory root."""
    target_path = expand_path(target_path)
    directories = load_directories_config() if directories is None else directories

    for directory in directories:
        dir_path = expand_path(directory['path'])
        try:
            target_path.relative_to(dir_path)
            return True
        except ValueError:
            continue

    return False


def validate_move_paths(source_path, target_directory):
    """Validate a move operation and return (destination_path, error_tuple|None)."""
    source_path = expand_path(source_path)
    target_directory = expand_path(target_directory)

    if not is_path_in_directories(source_path):
        return None, ('无权限访问源路径', 403)

    if not is_path_in_directories(target_directory):
        return None, ('无权限移动到目标目录', 403)

    if not source_path.exists():
        return None, ('源路径不存在', 404)

    if not target_directory.exists():
        return None, ('目标目录不存在', 404)

    if not target_directory.is_dir():
        return None, ('目标路径不是目录', 400)

    destination_path = target_directory / source_path.name

    if source_path == destination_path:
        return None, ('源路径和目标路径相同', 400)

    if destination_path.exists():
        return None, ('目标目录中已存在同名文件或目录', 409)

    if source_path.is_dir():
        try:
            target_directory.relative_to(source_path)
            return None, ('不能将目录移动到其自身或子目录中', 400)
        except ValueError:
            pass

    return destination_path, None
