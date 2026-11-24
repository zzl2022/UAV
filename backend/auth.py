"""Small signed-cookie login gate for the static platform.

Configured through environment variables (normally /etc/uav/uav-web.env):
  UAV_WEB_USER, UAV_WEB_PASSWORD, UAV_SESSION_SECRET
When any is missing the gate is disabled, which keeps local `npm run dev`
and the existing loopback API usable without a login step.
"""
from http.cookies import SimpleCookie
import base64
import hashlib
import hmac
import os
import time

COOKIE = 'uav_session'
TTL_SECONDS = 12 * 3600


def _config():
    user = os.environ.get('UAV_WEB_USER', '').strip()
    password = os.environ.get('UAV_WEB_PASSWORD', '')
    secret = os.environ.get('UAV_SESSION_SECRET', '')
    return user, password, secret


def enabled():
    user, password, secret = _config()
    return bool(user and password and secret)


def check_credentials(username, password):
    user, expected, _ = _config()
    if not (user and expected):
        return False
    return (hmac.compare_digest(str(username), user)
            and hmac.compare_digest(str(password), expected))


def issue_token():
    user, _, secret = _config()
    expires = int(time.time()) + TTL_SECONDS
    payload = f'{user}|{expires}'.encode('utf-8')
    body = base64.urlsafe_b64encode(payload).decode('ascii').rstrip('=')
    signature = hmac.new(secret.encode('utf-8'), body.encode('ascii'),
                         hashlib.sha256).hexdigest()
    return f'{body}.{signature}'


def verify_token(token):
    if not token or '.' not in token:
        return False
    body, signature = token.rsplit('.', 1)
    user, _, secret = _config()
    if not (user and secret):
        return False
    expected = hmac.new(secret.encode('utf-8'), body.encode('ascii'),
                        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        padded = body + '=' * (-len(body) % 4)
        decoded = base64.urlsafe_b64decode(padded).decode('utf-8')
        token_user, expires = decoded.rsplit('|', 1)
        return token_user == user and int(expires) >= int(time.time())
    except (ValueError, UnicodeDecodeError):
        return False


def cookie_token(header):
    if not header:
        return None
    jar = SimpleCookie()
    try:
        jar.load(header)
    except Exception:
        return None
    morsel = jar.get(COOKIE)
    return morsel.value if morsel else None


def authenticated(cookie_header):
    if not enabled():
        return True
    return verify_token(cookie_token(cookie_header))


def login_cookie():
    return (f'{COOKIE}={issue_token()}; Path=/; HttpOnly; SameSite=Lax; '
            f'Max-Age={TTL_SECONDS}')


def logout_cookie():
    return f'{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
