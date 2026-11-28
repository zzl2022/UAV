"""自定义区域的上传、后台生成和持久化索引。"""

from dataclasses import dataclass, field
import json
import logging
import os
from pathlib import Path
from queue import Queue
import re
import shutil
import subprocess
import sys
from tempfile import NamedTemporaryFile, TemporaryDirectory
from threading import Event, Lock, RLock, Thread
import time
import unicodedata
from urllib.parse import unquote
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / 'public/data/custom-sites'
MAX_FILE = 64 * 1024 ** 2
MAX_TOTAL = 200 * 1024 ** 2
MAX_FILES = 200
MAX_AGE = 24 * 60 * 60
BUILD_TIMEOUT = 900
EXTENSIONS = {'.shp', '.dbf', '.prj', '.cpg', '.tif', '.tiff', '.json', '.glb', '.jpg', '.jpeg', '.png'}
ID = re.compile(r'[0-9a-f]{32}')
SLUG = re.compile(r'custom-[0-9a-f]{32}')
DELETED_PREFIX = '.deleted-'
CORE_BACKUP_PREFIX = '.core-previous-'
ASSET_SUFFIXES = ('-gba.json', '-gba-meta.json', '-terrain.json', '-imagery.jpg', '-imagery.json')
LOGGER = logging.getLogger(__name__)


class SiteError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def relative_path(encoded):
    try:
        parts = [unicodedata.normalize('NFC', part) for part in unquote(encoded, errors='strict').split('/')]
    except UnicodeError as exc:
        raise SiteError('文件相对路径不是有效的 UTF-8') from exc
    for part in parts:
        reserved = part.split('.')[0].rstrip().casefold()
        if (not part or part in {'.', '..'} or len(part.encode('utf-8')) > 255
                or part.endswith(('.', ' ')) or re.search(r'[<>:"\\|?*]', part)
                or any(unicodedata.category(ch) in {'Cc', 'Cf', 'Cs'} for ch in part)
                or reserved in {'con', 'prn', 'aux', 'nul'}
                or re.fullmatch(r'(com|lpt)[1-9¹²³]', reserved)):
            raise SiteError('文件相对路径包含上级目录、绝对路径或非法字符')
    path = Path(*parts)
    if path.suffix.lower() not in EXTENSIONS:
        raise SiteError(f'不支持的文件扩展名：{path.name}', 415)
    return path


def linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def json_file(path):
    return json.loads(path.read_text(encoding='utf-8'))


def move_model_directory(source, target):
    # Windows 的索引器或文件读取器可能短暂占用目录。
    for attempt in range(6):
        try:
            source.rename(target)
            return
        except PermissionError as exc:
            if attempt == 5 or getattr(exc, 'winerror', None) not in (5, 32, 33):
                raise
            time.sleep(.1 * (attempt + 1))


@dataclass
class Upload:
    folder: Path
    lock: Lock = field(default_factory=Lock)
    cancelled: Event = field(default_factory=Event)
    files: set = field(default_factory=set)
    size: int = 0
    updated: float = field(default_factory=time.time)
    job: str | None = None


@dataclass
class Build:
    folder: Path
    upload: Upload
    slug: str
    name: str
    status: str = 'queued'
    stage: str = '等待生成'
    progress: int = 0
    error: str | None = None
    site: dict | None = None


class SiteService:
    def __init__(self, folder=None):
        self.folder = Path(folder or os.environ.get('UAV_CUSTOM_SITES_DIR') or DEFAULT_DIR).resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        work_parent = ROOT if self.folder.is_relative_to(ROOT / 'public') else self.folder.parent
        work_root = work_parent / '.custom-sites-work'
        self.work = work_root / self.folder.name
        if linked(work_root) or linked(self.work):
            raise RuntimeError('自定义区域暂存目录不能是链接')
        work_root.mkdir(mode=0o700, exist_ok=True)
        self.work.mkdir(mode=0o700, exist_ok=True)
        self.index = self.folder / 'index.json'
        self.lock = RLock()
        self.uploads = {}
        self.builds = {}
        self.queue = Queue()
        self._recover_deletions()
        self._recover_core_edits()
        self._prune()
        self.worker = Thread(target=self._work, name='custom-sites', daemon=True)
        self.worker.start()

    def close(self):
        with self.lock:
            for job in self.builds.values():
                if job.status in {'queued', 'running'}:
                    job.upload.cancelled.set()
        self.queue.put(None)
        self.worker.join()

    def _prune(self):
        cutoff = time.time() - MAX_AGE
        active = {upload.folder.parent for upload in self.uploads.values()
                  if upload.updated >= cutoff or (upload.job and self.builds[upload.job].status in {'queued', 'running'})}
        for folder in self.work.iterdir():
            if (ID.fullmatch(folder.name) and folder not in active and not linked(folder)
                    and folder.is_dir() and folder.stat().st_mtime < cutoff):
                shutil.rmtree(folder)
        for key, upload in tuple(self.uploads.items()):
            if upload.updated < cutoff and upload.folder.parent not in active:
                self.uploads.pop(key)
                if upload.job:
                    self.builds.pop(upload.job, None)

    def create(self):
        with self.lock:
            self._prune()
            upload_id = uuid4().hex
            folder = self.work / upload_id / 'input'
            folder.mkdir(parents=True)
            self.uploads[upload_id] = Upload(folder)
        return {'uploadId': upload_id}

    def _upload(self, upload_id):
        with self.lock:
            upload = self.uploads.get(upload_id)
        if not upload or upload.cancelled.is_set():
            raise SiteError('上传会话不存在或已取消，请重新选择文件夹', 404)
        return upload

    def put_file(self, upload_id, encoded_path, content_length, stream):
        path = relative_path(encoded_path)
        try:
            length = int(content_length)
        except (ValueError, TypeError) as exc:
            raise SiteError('上传文件需要有效的 Content-Length', 411) from exc
        if length <= 0:
            raise SiteError(f'文件为空：{path.name}')
        if length > MAX_FILE:
            raise SiteError(f'单个文件不能超过 64 MB：{path.name}', 413)
        upload = self._upload(upload_id)
        with upload.lock:
            if upload.cancelled.is_set() or upload.job:
                raise SiteError('上传会话已关闭，请重新选择文件夹', 409)
            if len(upload.files) >= MAX_FILES or upload.size + length > MAX_TOTAL:
                raise SiteError('每个模型最多上传 200 个文件，总大小不能超过 200 MB', 413)
            casefolded = path.as_posix().casefold()
            if casefolded in upload.files:
                raise SiteError(f'文件路径重复：{path.as_posix()}', 409)
            destination = upload.folder / path
            for parent in (upload.folder.parent, upload.folder, *reversed(path.parents)):
                directory = upload.folder / parent
                if linked(directory) or (directory.exists() and not directory.is_dir()):
                    raise SiteError('文件路径包含链接或与已有文件冲突')
            if destination.exists() or linked(destination):
                raise SiteError('文件路径与已有文件或目录冲突')
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(f'.{uuid4().hex}.part')
            upload.updated = time.time()
            try:
                with temporary.open('xb') as output:
                    remaining = length
                    while remaining:
                        if upload.cancelled.is_set():
                            raise SiteError('上传已取消', 409)
                        chunk = stream.read(min(remaining, 1024 * 1024))
                        if not chunk:
                            raise SiteError(f'文件上传中断：{path.name}')
                        output.write(chunk)
                        remaining -= len(chunk)
                temporary.rename(destination)
            finally:
                temporary.unlink(missing_ok=True)
                upload.updated = time.time()
            upload.files.add(casefolded)
            upload.size += length
        return {'size': length}

    def start(self, upload_id, name):
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 24
                or any(unicodedata.category(ch) in {'Cc', 'Cs'} for ch in name)):
            raise SiteError('模型名称需为 1–24 个字符，且不能包含控制字符')
        upload = self._upload(upload_id)
        with upload.lock, self.lock:
            if upload.cancelled.is_set() or upload.job:
                raise SiteError('上传会话已关闭，请重新选择文件夹', 409)
            if not upload.files:
                raise SiteError('请先上传区域数据文件')
            job_id = uuid4().hex
            upload.job = job_id
            job = Build(upload.folder.parent, upload, f'custom-{uuid4().hex}', name.strip())
            self.builds[job_id] = job
            self.queue.put(job)
        return {'jobId': job_id}

    def cancel(self, upload_id):
        upload = self._upload(upload_id)
        with self.lock:
            job = self.builds.get(upload.job)
            if job and job.status == 'done':
                raise SiteError('模型已生成，已加入区域列表', 409)
            upload.cancelled.set()
            if job and job.status != 'failed':
                job.status, job.stage, job.error = 'failed', '已取消', '生成已取消'
        if not job:
            with upload.lock:
                shutil.rmtree(upload.folder.parent)
            with self.lock:
                self.uploads.pop(upload_id, None)
        return {'cancelled': True}

    def state(self, job_id):
        with self.lock:
            job = self.builds.get(job_id)
            if not job:
                raise SiteError('生成任务不存在，请重新开始', 404)
            result = {'status': job.status, 'stage': job.stage, 'progress': job.progress, 'error': job.error}
            if job.status == 'running':
                update = self._progress(job)
                if update and not update['error']:
                    result['stage'] = update['stage']
                    result['progress'] = min(update['progress'], 99)
            if job.site is not None:
                result['site'] = job.site
            return result

    def list_sites(self):
        with self.lock:
            return json_file(self.index) if self.index.exists() else []

    def _site_directory(self, slug):
        path = self.folder / slug
        if linked(self.folder) or linked(path) or path.resolve().parent != self.folder:
            raise SiteError('自定义模型目录无效', 400)
        if not path.is_dir():
            raise SiteError('自定义模型文件不存在', 404)
        return path

    def delete(self, slug):
        if not SLUG.fullmatch(slug):
            raise SiteError('只能删除有效的自定义模型', 400)
        with self.lock:
            entries = self.list_sites()
            retained = [entry for entry in entries if entry['slug'] != slug]
            if len(retained) == len(entries):
                raise SiteError('自定义模型不存在', 404)
            directory = self._site_directory(slug)
            pending = self.folder / f'{DELETED_PREFIX}{slug}'
            if pending.exists() or linked(pending):
                raise SiteError('该模型有未完成的删除记录，请稍后重试', 409)
            move_model_directory(directory, pending)
            try:
                self._write_index(retained)
            except Exception:
                move_model_directory(pending, directory)
                raise
            self._remove_pending(pending)
        return {'ok': True, 'slug': slug}

    def _remove_pending(self, pending):
        try:
            shutil.rmtree(pending)
        except OSError:
            LOGGER.exception('清理自定义模型暂存失败：%s', pending.name)

    def _recover_deletions(self):
        candidates = [path for path in self.folder.glob(f'{DELETED_PREFIX}custom-*')
                      if SLUG.fullmatch(path.name.removeprefix(DELETED_PREFIX))
                      and not linked(path) and path.is_dir()]
        if not candidates:
            return
        indexed = {entry['slug'] for entry in self.list_sites()}
        for pending in candidates:
            slug = pending.name.removeprefix(DELETED_PREFIX)
            original = self.folder / slug
            if slug not in indexed:
                self._remove_pending(pending)
            elif not original.exists() and not linked(original):
                move_model_directory(pending, original)

    def update_core(self, slug, name, building_ids):
        if not SLUG.fullmatch(slug):
            raise SiteError('只能修改自定义模型的核心建筑')
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 24
                or any(unicodedata.category(ch) in {'Cc', 'Cf', 'Cs'} for ch in name)):
            raise SiteError('核心建筑名称需为 1–24 个字符，且不能包含控制字符')
        if (not isinstance(building_ids, list) or len(building_ids) > 50
                or any(not isinstance(bid, str) or not bid for bid in building_ids)):
            raise SiteError('请选择 0–50 栋建筑，并提供有效的建筑编号')
        if len(set(building_ids)) != len(building_ids):
            raise SiteError('核心建筑编号不能重复')
        with self.lock:
            entries = self.list_sites()
            entry = next((entry for entry in entries if entry['slug'] == slug), None)
            if entry is None:
                raise SiteError('自定义模型不存在', 404)
            directory = self._site_directory(slug)
            meta_file = directory / f'{slug}-gba-meta.json'
            city_file = directory / f'{slug}-gba.json'
            if linked(meta_file) or linked(city_file):
                raise SiteError('自定义模型包含无效文件链接')
            meta, city = json_file(meta_file), json_file(city_file)
            buildings = {building['id']: building for building in city['buildings']}
            if any(bid not in buildings for bid in building_ids):
                raise SiteError('选择中有建筑不属于当前自定义模型')
            cores = []
            for bid in building_ids:
                building = buildings[bid]
                ring = building['rings'][0]
                xs, zs = [point[0] for point in ring], [point[2] for point in ring]
                cores.append({'id': bid, 'name': name.strip(), 'height': building['height'],
                              'rings': building['rings'], 'center': [(min(xs) + max(xs)) / 2,
                                                                     (min(zs) + max(zs)) / 2]})
            if not meta.get('analysisAnchor'):
                # 早期用自动核心的新建模型可能没有保存区域分析锚点。
                terrain_file = directory / f'{slug}-terrain.json'
                if linked(terrain_file):
                    raise SiteError('自定义模型包含无效文件链接')
                terrain = json_file(terrain_file)
                west, east, south, north = meta['localBounds']
                x, z = (west + east) / 2, (south + north) / 2
                coords = terrain['positions']
                index = min(terrain['indices'], key=lambda i: ((coords[3*i]-x)**2+(coords[3*i+2]-z)**2, i))
                meta['analysisAnchor'] = coords[index*3:index*3+3]
            revision = uuid4().hex
            core_name = name.strip() if cores else None
            meta.update(coreName=core_name, coreBuildings=cores, coreBuilding=cores[0] if len(cores) == 1 else None,
                        coreRevision=revision)
            city['metadata'] = meta
            entry.update(coreName=core_name, coreRevision=revision)
            self._replace_core_files(slug, directory, city, meta, entries)
            return {'metadata': meta}

    def _replace_core_files(self, slug, directory, city, meta, entries):
        backup = self.folder / f'{CORE_BACKUP_PREFIX}{slug}'
        if backup.exists() or linked(backup):
            raise SiteError('该模型有未完成的核心编辑记录，请稍后重试', 409)
        with TemporaryDirectory(prefix='.core-edit-', dir=self.folder) as temp:
            replacement = Path(temp) / slug
            replacement.mkdir(mode=directory.stat().st_mode & 0o777)
            for suffix in ('-terrain.json', '-imagery.json', '-imagery.jpg'):
                source = directory / f'{slug}{suffix}'
                if linked(source):
                    raise SiteError('自定义模型包含无效文件链接')
                if source.is_file():
                    shutil.copy2(source, replacement / source.name)
            for suffix, value in (('-gba.json', city), ('-gba-meta.json', meta)):
                (replacement / f'{slug}{suffix}').write_text(
                    json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
            move_model_directory(directory, backup)
            try:
                move_model_directory(replacement, directory)
                self._write_index(entries)
            except Exception:
                if directory.exists():
                    move_model_directory(directory, replacement)
                move_model_directory(backup, directory)
                raise
            self._remove_pending(backup)

    def _recover_core_edits(self):
        candidates = [path for path in self.folder.glob(f'{CORE_BACKUP_PREFIX}custom-*')
                      if SLUG.fullmatch(path.name.removeprefix(CORE_BACKUP_PREFIX))
                      and not linked(path) and path.is_dir()]
        if not candidates:
            return
        indexed = {entry['slug']: entry for entry in self.list_sites()}
        for backup in candidates:
            slug = backup.name.removeprefix(CORE_BACKUP_PREFIX)
            entry = indexed.get(slug)
            directory = self.folder / slug
            if not entry:
                self._remove_pending(backup)
                continue
            if linked(directory):
                continue
            if not directory.exists():
                move_model_directory(backup, directory)
                continue
            meta = directory / f'{slug}-gba-meta.json'
            if linked(meta):
                continue
            if entry.get('coreRevision') == json_file(meta).get('coreRevision'):
                self._remove_pending(backup)
            else:
                with TemporaryDirectory(prefix='.core-edit-', dir=self.folder) as temp:
                    move_model_directory(directory, Path(temp) / slug)
                    move_model_directory(backup, directory)

    def asset(self, slug, filename):
        if not (SLUG.fullmatch(slug) and filename in {slug + suffix for suffix in ASSET_SUFFIXES}):
            raise SiteError('自定义模型文件不存在', 404)
        if not any(entry['slug'] == slug for entry in self.list_sites()):
            raise SiteError('自定义模型不存在', 404)
        path = self.folder / slug / filename
        if linked(path.parent) or linked(path) or not path.is_file():
            raise SiteError('自定义模型文件不存在', 404)
        return path

    def _log_tail(self, job):
        try:
            with (job.folder / 'build.log').open('rb') as log:
                log.seek(max(0, log.seek(0, os.SEEK_END) - 16384))
                return log.read(16384).decode('utf-8', errors='replace')
        except OSError:
            return ''

    def _progress(self, job):
        for line in reversed(self._log_tail(job).splitlines()):
            if line.startswith('{"stage":'):
                try:
                    return json.loads(line)
                except ValueError:
                    continue
        return None

    def _work(self):
        while True:
            job = self.queue.get()
            if job is None:
                return
            try:
                self._run(job)
            except Exception:
                LOGGER.exception('自定义模型生成服务异常')
                self._fail(job, '生成服务异常，请稍后重试')
            finally:
                shutil.rmtree(job.upload.folder, ignore_errors=True)
                shutil.rmtree(job.folder / 'output', ignore_errors=True)
                job.upload.updated = time.time()
                self.queue.task_done()

    def _fail(self, job, message):
        with self.lock:
            if not job.upload.cancelled.is_set():
                job.status, job.stage, job.error = 'failed', '生成失败', message

    def _run(self, job):
        with self.lock:
            if job.upload.cancelled.is_set():
                return
            job.status, job.stage, job.progress = 'running', '启动生成程序', 1
        log = job.folder / 'build.log'
        output = job.folder / 'output'
        command = [sys.executable, '-X', 'utf8', str(ROOT / 'scripts/build_custom_site.py'),
                   '--input', str(job.upload.folder), '--slug', job.slug, '--name', job.name,
                   '--out', str(output)]
        with log.open('wb') as console, subprocess.Popen(command, cwd=ROOT, stdout=console, stderr=subprocess.STDOUT) as process:
            deadline = time.monotonic() + BUILD_TIMEOUT
            while process.poll() is None:
                cancelled = job.upload.cancelled.wait(0.2)
                if cancelled or time.monotonic() >= deadline:
                    process.kill()
                    process.wait()
                    if not cancelled:
                        self._fail(job, '生成超时，请缩小区域或减少源文件后重试')
                    return
        if process.returncode != 0:
            LOGGER.error('自定义模型生成失败 %s，完整日志 %s\n%s',
                         job.slug, log, self._log_tail(job))
            update = self._progress(job)
            self._fail(job, (update or {}).get('error') or '生成失败，请检查源文件并重试')
            return
        with self.lock:
            if not job.upload.cancelled.is_set():
                job.site = self._publish(job.slug, output / job.slug)
                job.status, job.stage, job.progress = 'done', '模型生成完成', 100

    def _publish(self, slug, source):
        meta = json_file(source / f'{slug}-gba-meta.json')
        base = f'./data/custom-sites/{slug}/{slug}'
        entry = {key: meta[key] for key in ('name', 'createdAt', 'buildingCount', 'maxHeight', 'center')}
        entry.update(slug=slug, base=f'{base}-gba', coreName=meta.get('coreName'), imagery=f'{base}-imagery.jpg'
                     if (source / f'{slug}-imagery.jpg').is_file() else None)
        entries = [*self.list_sites(), entry]
        destination = self.folder / slug
        move_model_directory(source, destination)
        try:
            self._write_index(entries)
        except Exception:
            shutil.rmtree(destination)
            raise
        return entry

    def _write_index(self, entries):
        temporary = None
        try:
            with NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.folder, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(entries, stream, ensure_ascii=False, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.index)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
