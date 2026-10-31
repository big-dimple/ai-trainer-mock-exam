# -*- coding: utf-8 -*-
"""人工智能训练师刷题系统 - 服务端（仅依赖 Python 标准库）

python server.py                 本机使用  http://127.0.0.1:8848
HOST=0.0.0.0 python server.py    公网/局域网部署（务必在 config.json 设置 auth 密码）
配置：config.json（参考 config.example.json），环境变量可覆盖。
"""
import base64, json, os, shutil, sys, time, pathlib, threading, webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

APP = pathlib.Path(__file__).resolve().parent
ROOT = APP.parent
WEB = APP / "web"
BANK = APP / "data" / "bank"
PROGRESS_DIR = APP / "data" / "progress"   # 按浏览器用户隔离的进度目录
PROGRESS = APP / "data" / "progress.json"  # 旧版单用户进度文件，首次访问时迁移给第一个用户
SUBMIT = APP / "submissions"
FEEDBACK = APP / "feedback"
DOCS = ROOT / "备考输出"
CONFIG = APP / "config.json"
LOCK = threading.Lock()

for d in (SUBMIT, FEEDBACK, PROGRESS_DIR):
    d.mkdir(parents=True, exist_ok=True)


def read_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(p, obj):
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def load_bank():
    """题库缓存：任一 bank 文件变动（含增删）自动重建，避免每次请求重读全部文件。"""
    mt = max((f.stat().st_mtime for f in BANK.glob("*.json")), default=0)
    if _BANK_CACHE["mtime"] != mt:
        items, files = [], []
        for f in sorted(BANK.glob("*.json")):
            data = read_json(f, None)
            if not isinstance(data, list):
                files.append({"file": f.name, "error": "invalid json"})
                continue
            for q in data:
                q["_file"] = f.name
            items.extend(data)
            files.append({"file": f.name, "count": len(data)})
        _BANK_CACHE.update(mtime=mt, payload={"items": items, "files": files})
    return _BANK_CACHE["payload"]


_BANK_CACHE = {"mtime": None, "payload": None}


def backup_progress():
    """启动时给所有用户进度做滚动备份（每天每用户一份，保留最近 30 份），防误覆盖丢进度。"""
    bak = PROGRESS.parent / "backups"
    bak.mkdir(exist_ok=True)
    files = ([PROGRESS] if PROGRESS.is_file() else []) + sorted(PROGRESS_DIR.glob("*.json"))
    for f in files:
        dst = bak / f"{f.stem}-{time.strftime('%Y%m%d')}.json"
        if not dst.exists():
            shutil.copy2(f, dst)
    for old in sorted(bak.glob("*.json"))[:-30]:
        old.unlink(missing_ok=True)


def load_config():
    cfg = read_json(CONFIG, {})
    cfg.setdefault("host", "127.0.0.1")
    cfg.setdefault("port", 8848)
    cfg.setdefault("auth", {})
    llm = cfg.setdefault("llm", {})
    llm.setdefault("auto_grade", True)
    env = os.environ
    if env.get("HOST"): cfg["host"] = env["HOST"]
    if env.get("PORT"): cfg["port"] = int(env["PORT"])
    if env.get("EXAM_USER"): cfg["auth"]["user"] = env["EXAM_USER"]
    if env.get("EXAM_PASSWORD"): cfg["auth"]["password"] = env["EXAM_PASSWORD"]
    for k, e in (("base_url", "LLM_BASE_URL"), ("api_key", "LLM_API_KEY"), ("model", "LLM_MODEL")):
        if env.get(e): llm[k] = env[e]
    return cfg


CFG = load_config()
from grader import LLM, grade_submission  # noqa: E402

LLM_CLIENT = LLM(CFG["llm"])
GRADING = {}  # sid -> {"status": "grading"|"error", "done": n, "total": n, "error": str}


def start_grading(sid):
    if not LLM_CLIENT.ok or GRADING.get(sid, {}).get("status") == "grading":
        return False
    sub = read_json(SUBMIT / f"{sid}.json", None)
    if not sub or not sub.get("subjective"):
        return False
    GRADING[sid] = {"status": "grading", "done": 0, "total": len(sub["subjective"])}

    def run():
        def prog(d, n):
            GRADING[sid].update(done=d, total=n)
        try:
            grade_submission(LLM_CLIENT, sid, prog)
            GRADING.pop(sid, None)
            print(f"[评卷完成] {sid}", flush=True)
        except Exception as e:
            GRADING[sid] = {"status": "error", "error": str(e)[:300]}
            print(f"[评卷失败] {sid}: {e}", flush=True)

    threading.Thread(target=run, daemon=True).start()
    return True


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0] if args else "") and "/api/submission/" not in str(args[0]):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "public, max-age=604800" if self.path.startswith("/vendor/") else "no-store")
        super().end_headers()

    def _authed(self):
        a = CFG.get("auth") or {}
        if not a.get("password"):
            return True
        want = base64.b64encode(f"{a.get('user', 'admin')}:{a['password']}".encode()).decode()
        if self.headers.get("Authorization", "") == "Basic " + want:
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="ai-trainer-exam", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        if n > 5 * 1024 * 1024:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def _uid(self):
        """浏览器自动分配的身份 ID（前端 X-Exam-Uid 头），用于进度/答卷按用户隔离。"""
        u = self.headers.get("X-Exam-Uid") or parse_qs(urlparse(self.path).query).get("uid", [""])[0]
        u = "".join(c for c in str(u) if c.isalnum() or c in "-_")[:40]
        return u or "default"

    def _scope(self, name):
        """把答卷 id 映射到当前用户的命名空间（文件名前缀）。"""
        return f"{self._uid()}--{name}"

    def _unscope(self, scoped):
        pre = f"{self._uid()}--"
        return scoped[len(pre):] if scoped.startswith(pre) else scoped

    def _progress_file(self):
        return PROGRESS_DIR / f"{self._uid()}.json"

    def do_GET(self):
        if not self._authed():
            return
        u = urlparse(self.path)
        p = u.path
        if p == "/api/config":
            return self._json({"llm": LLM_CLIENT.ok, "model": LLM_CLIENT.model if LLM_CLIENT.ok else None,
                               "auto_grade": bool(CFG["llm"].get("auto_grade"))})
        if p == "/api/bank":
            return self._json(load_bank())
        if p == "/api/progress":
            pf = self._progress_file()
            data = read_json(pf, None)
            if data is None:
                # 旧版单用户进度迁移：目录还没有任何用户文件时，把旧文件给第一个访问者
                with LOCK:
                    if PROGRESS.is_file() and not any(PROGRESS_DIR.glob("*.json")):
                        shutil.copy2(PROGRESS, pf)
                data = read_json(pf, {})
            return self._json(data)
        if p == "/api/doc":
            name = unquote(parse_qs(u.query).get("name", [""])[0])
            f = (DOCS / name).resolve()
            if DOCS.resolve() not in f.parents or not f.is_file():
                return self._json({"error": "not found"}, 404)
            return self._json({"name": name, "text": f.read_text(encoding="utf-8")})
        if p == "/api/submissions":
            out = []
            for f in sorted(SUBMIT.glob(f"{self._uid()}--*.json"), reverse=True):
                s = read_json(f, {})
                sid = self._unscope(s.get("id") or f.stem)
                out.append({"id": sid, "created": s.get("created"), "kind": s.get("kind"),
                            "title": s.get("title"), "autoScore": s.get("autoScore"), "maxScore": s.get("maxScore"),
                            "hasSubjective": bool(s.get("subjective")),
                            "feedback": read_json(FEEDBACK / f.name, None), "grading": GRADING.get(f.stem)})
            return self._json(out)
        if p.startswith("/api/submission/"):
            scoped = self._scope(p.rsplit("/", 1)[-1])
            s = read_json(SUBMIT / f"{scoped}.json", None)
            if s is None:
                return self._json({"error": "not found"}, 404)
            return self._json({"submission": s, "feedback": read_json(FEEDBACK / f"{scoped}.json", None),
                               "grading": GRADING.get(scoped)})
        return super().do_GET()

    def do_POST(self):
        if not self._authed():
            return
        p = urlparse(self.path).path
        try:
            body = self._body()
        except Exception as e:
            return self._json({"error": str(e)}, 400)
        if not isinstance(body, dict):
            return self._json({"error": "body must be a JSON object"}, 400)
        if p == "/api/progress":
            if not isinstance(body, dict):
                return self._json({"error": "progress must be an object"}, 400)
            with LOCK:
                write_json(self._progress_file(), body)
            return self._json({"ok": True})
        if p == "/api/submit":
            sid = "".join(c for c in str(body.get("id") or time.strftime("%Y%m%d-%H%M%S")) if c.isalnum() or c in "-_")
            body["id"] = sid
            scoped = self._scope(sid)
            with LOCK:
                write_json(SUBMIT / f"{scoped}.json", body)
            grading = CFG["llm"].get("auto_grade") and start_grading(scoped)
            return self._json({"ok": True, "id": sid, "grading": bool(grading)})
        if p.startswith("/api/grade/"):
            scoped = self._scope(p.rsplit("/", 1)[-1])
            if not LLM_CLIENT.ok:
                return self._json({"ok": False, "error": "服务端未配置评卷模型"}, 400)
            (FEEDBACK / f"{scoped}.json").unlink(missing_ok=True)
            return self._json({"ok": start_grading(scoped)})
        return self._json({"error": "unknown"}, 404)


def main():
    backup_progress()
    if os.name == "nt":
        ThreadingHTTPServer.allow_reuse_address = False  # Windows 上允许重复绑定会让新旧进程同时监听同一端口
    host, port = CFG["host"], int(CFG["port"])
    srv = None
    for pt in (port, 8848, 18765, 28765, 0):
        try:
            srv = ThreadingHTTPServer((host, pt), H)
            break
        except OSError:
            continue
    shown = "127.0.0.1" if host in ("0.0.0.0", "") else host
    url = f"http://{shown}:{srv.server_address[1]}/"
    print(f"刷题系统已启动：{url}  监听 {host}:{srv.server_address[1]}  (Ctrl+C 退出)", flush=True)
    print(f"AI 评卷：{'已启用 ' + LLM_CLIENT.model + ' @ ' + LLM_CLIENT.base if LLM_CLIENT.ok else '未配置（见 config.example.json）'}", flush=True)
    if host not in ("127.0.0.1", "localhost") and not (CFG.get("auth") or {}).get("password"):
        print("⚠️  当前监听非本机地址且未设置访问密码，任何人都能访问并消耗你的模型额度！请在 config.json 设置 auth.password", flush=True)
    if "--no-browser" not in sys.argv and host in ("127.0.0.1", "localhost"):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
