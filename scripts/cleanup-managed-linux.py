#!/usr/bin/env python3
"""Prune managed application artifacts without opening conversation databases."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time


def cleanup(home, dry_run=False):
    root = home / '.local/opt/t3code'
    managed = root / 'managed'
    managed.mkdir(parents=True, exist_ok=True)
    locks = []
    for path in [managed / '.cleanup.lock', managed / 'runtime/.extract.lock']:
        if path.parent.exists():
            lock = path.open('a')
            fcntl.flock(lock, fcntl.LOCK_EX)
            locks.append(lock)
    try:
        return prune(home, root, managed, dry_run)
    finally:
        for lock in locks:
            lock.close()


def prune(home, root, managed, dry_run):
    versions = home / '.t3/runtime/versions'
    references = []
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != os.getuid():
                continue
            executable = os.readlink(process / 'exe')
        except FileNotFoundError:
            continue
        except PermissionError:
            name = (process / 'comm').read_text().strip().lower()
            if name.startswith(('t3', 'appimage')):
                raise RuntimeError('Cannot inspect a running T3 executable')
            continue
        references.append(executable)
        try:
            references.extend((process / 'cmdline').read_bytes().decode(errors='replace').split('\0'))
            for value in (process / 'environ').read_bytes().decode(errors='replace').split('\0'):
                if value.startswith(('APPIMAGE=', 'T3CODE_SERVER_RUNTIME=', 'T3CODE_CLI_PATH=')):
                    references.append(value.split('=', 1)[1])
            references.extend(str(path.resolve()) for path in (process / 'fd').iterdir())
        except FileNotFoundError:
            continue
        except PermissionError:
            # Sandboxed helpers hide their environment; their executable remains protected.
            continue
    for folder, pattern in [
        (home / '.local/bin', '*t3*'),
        (home / '.local/share/applications', '*t3*.desktop'),
        (home / '.config/autostart', '*t3*.desktop'),
        (home / '.config/systemd/user', '**/*t3*'),
    ]:
        for path in folder.glob(pattern):
            references.append(str(path.resolve()))
            if path.is_file():
                with path.open('rb') as source:
                    text = source.read(32768)
                if not text.startswith(b'\x7fELF'):
                    references.append(text.decode(errors='replace'))
    image = managed / 'T3-Code.AppImage'
    keep = set()
    if image.is_file():
        with image.open('rb') as source:
            keep.add(managed / 'runtime' / hashlib.file_digest(source, 'sha256').hexdigest())
        references.append(str(image.resolve()))
    state_path = home / '.t3/runtime/service-state.json'
    if state_path.exists():
        state = json.loads(state_path.read_text())
        keep.add(versions / state['activeVersion'])
        update = state.get('update')
        if update:
            keep.update(versions / update[key] for key in ['fromVersion', 'targetVersion'])

    def referenced(path):
        names = [str(path), str(path.resolve())]
        return any(re.search(re.escape(name) + r'(?=$|[/\s\x00\"\'])', ref)
                   for name in names for ref in references)

    candidates = []
    for base in [root / 'snapshots', managed / 'runtime', versions]:
        if not base.is_dir():
            continue
        for path in base.iterdir():
            if path.is_symlink() or not path.is_dir() or path in keep or referenced(path):
                continue
            if base == versions:
                if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?', path.name):
                    continue
                sentinel = path / '.install-complete'
                if not sentinel.is_file() or sentinel.read_text().strip() != path.name:
                    continue
                # Upstream also leaves an hour for a newly installed runtime to be selected.
                if time.time() - sentinel.stat().st_mtime < 3600:
                    continue
            elif not re.fullmatch(r'[0-9a-f]{12}|[0-9a-f]{64}', path.name):
                continue
            candidates.append(path)
    for folder in [root, managed]:
        for path in folder.iterdir():
            if 'backup' not in path.name and '.before-' not in path.name:
                continue
            # Migration snapshots can contain conversation databases; upstream owns those.
            if path.name.startswith('server-migration-backup') or referenced(path):
                continue
            if path.is_dir() and any(path.rglob('*.sqlite*')):
                continue
            candidates.append(path)
    bootstrap = managed / 'server-bootstrap'
    if bootstrap.exists() and not referenced(bootstrap) and not any(bootstrap.rglob('*.sqlite*')):
        candidates.append(bootstrap)
    removed = []
    for path in candidates:
        if not dry_run:
            if path.is_symlink() or path.is_file():
                path.unlink()
            else:
                shutil.rmtree(path)
        removed.append(str(path.relative_to(home)))
    current = root / 'current'
    if not dry_run and current.is_symlink() and not current.exists():
        current.unlink()
    return {'dryRun': dry_run, 'removed': removed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    options = parser.parse_args()
    print(json.dumps(cleanup(Path.home(), options.dry_run)))
