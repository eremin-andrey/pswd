# Локальный сервер для Mac: отдаёт файлы программы и хранит зашифрованное
# хранилище обычным файлом на диске. Слушает только 127.0.0.1.
#
#   python3 server.py [--port 8765] [--vault ~/Documents/Пароли/pswd-vault.txt]
#
# Сервер видит только зашифрованный текст: шифрование и мастер-пароль
# остаются в браузере.

import argparse
import json
import os
import shutil
import tempfile
from urllib.parse import quote
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.dirname(os.path.abspath(__file__))
MAX_SIZE = 10 * 1024 * 1024
API = '/api/vault'


class Handler(SimpleHTTPRequestHandler):
    vault = None
    allowed_hosts = ()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # не пишем журнал запросов

    # Защита от чужих сайтов: Host проверяет подмену DNS, а Origin и
    # собственный заголовок не дают другой странице читать или писать файл
    def trusted(self):
        if self.headers.get('Host') not in self.allowed_hosts:
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin not in {'http://' + h for h in self.allowed_hosts}:
            return False
        return True

    def api_allowed(self):
        return self.trusted() and self.headers.get('X-Pswd') == '1'

    def reply(self, code, body=b'', ctype='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Pswd-Path', quote(self.vault.replace(os.path.expanduser('~'), '~', 1)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.trusted():
            return self.reply(403)
        if self.path.split('?')[0] != API:
            return super().do_GET()
        if not self.api_allowed():
            return self.reply(403)
        try:
            with open(self.vault, 'rb') as f:
                return self.reply(200, f.read())
        except FileNotFoundError:
            return self.reply(404)

    def do_HEAD(self):
        if not self.trusted():
            return self.reply(403)
        return super().do_HEAD()

    def do_PUT(self):
        if self.path != API or not self.api_allowed():
            return self.reply(403)
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_SIZE:
            return self.reply(413)
        body = self.rfile.read(length)
        try:
            data = json.loads(body.decode('utf-8'))
            assert data.get('format') == 'pswd-vault' and isinstance(data.get('ct'), str)
        except Exception:
            return self.reply(400, 'Не похоже на файл хранилища'.encode('utf-8'))

        folder = os.path.dirname(self.vault)
        os.makedirs(folder, exist_ok=True)
        if os.path.exists(self.vault):
            shutil.copy2(self.vault, os.path.splitext(self.vault)[0] + '.bak.txt')
        # Атомарная запись: сначала временный файл, потом подмена
        fd, tmp = tempfile.mkstemp(dir=folder, prefix='.pswd-', suffix='.tmp')
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.vault)
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
        return self.reply(204)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=8765)
    p.add_argument('--vault', default='~/Documents/Пароли/pswd-vault.txt')
    a = p.parse_args()

    Handler.vault = os.path.abspath(os.path.expanduser(a.vault))
    Handler.allowed_hosts = (f'localhost:{a.port}', f'127.0.0.1:{a.port}')
    server = ThreadingHTTPServer(('127.0.0.1', a.port), partial(Handler, directory=APP_DIR))
    print(f'http://localhost:{a.port}  →  {Handler.vault}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
