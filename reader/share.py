"""Share-link domain logic."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime

from flask import request

from .paths import expand_path, is_path_in_directories, simplify_path
from .storage import load_share_links, save_share_links


def serialize_datetime(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat() + 'Z'


def parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        return None


def update_share_links_for_move(source_path, destination_path) -> None:
    source_path = expand_path(source_path)
    destination_path = expand_path(destination_path)
    links = load_share_links()
    changed = False

    for link in links:
        link_path_raw = link.get('path', '')
        if not link_path_raw:
            continue

        link_path = expand_path(link_path_raw)
        new_link_path = None

        if link_path == source_path:
            new_link_path = destination_path
        elif source_path.is_dir():
            try:
                relative = link_path.relative_to(source_path)
                new_link_path = destination_path / relative
            except ValueError:
                continue
        else:
            continue

        link['path'] = str(new_link_path)
        link['display_path'] = simplify_path(new_link_path)
        link['title'] = new_link_path.name
        changed = True

    if changed:
        save_share_links(links)


def public_share_data(link: dict) -> dict:
    result = deepcopy(link)
    result.pop('token', None)
    result['url'] = request.host_url.rstrip('/') + f'/share/{link["token"]}'
    result['active'] = is_share_link_active(link)
    return result


def find_share_link(token: str):
    for link in load_share_links():
        if link.get('token') == token:
            return link
    return None


def is_share_link_active(link, enforce_view_limit: bool = True) -> bool:
    if not link or link.get('revoked_at'):
        return False

    expires_at = parse_datetime(link.get('expires_at'))
    if expires_at and expires_at < datetime.utcnow():
        return False

    max_views = link.get('max_views')
    if enforce_view_limit and max_views is not None and link.get('view_count', 0) >= max_views:
        return False

    file_path = expand_path(link.get('path', ''))
    if not is_path_in_directories(file_path):
        return False

    return file_path.exists() and file_path.is_file()


def increment_share_view(token: str):
    links = load_share_links()
    for link in links:
        if link.get('token') == token:
            link['view_count'] = link.get('view_count', 0) + 1
            link['last_viewed_at'] = serialize_datetime(datetime.utcnow())
            save_share_links(links)
            return link
    return None
