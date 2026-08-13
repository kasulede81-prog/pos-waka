#!/usr/bin/env bash
# Staging Ask WAKA smoke helper (non-production only).
# Requires: .local/waka-pos-staging.env + .local/waka-pos-staging-test-owner.env
# and DEEPSEEK_API_KEY configured on staging.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import json, urllib.request
from pathlib import Path

def load(path):
  env={}
  for line in Path(path).read_text().splitlines():
    if '=' in line and not line.startswith('#'):
      k,v=line.split('=',1); env[k]=v
  return env

st=load('.local/waka-pos-staging.env')
ow=load('.local/waka-pos-staging-test-owner.env')
assert st['STAGING_PROJECT_REF'] == 'wdirxwvbgsfzbdurmkbf'
assert st['STAGING_PROJECT_REF'] != 'ljaedextsenbkxzzgxcg'
base=st['STAGING_SUPABASE_URL'].rstrip('/')
anon=st['STAGING_ANON_KEY']
req=urllib.request.Request(
  base+'/auth/v1/token?grant_type=password',
  data=json.dumps({'email': ow['STAGING_TEST_EMAIL'], 'password': ow['STAGING_TEST_PASSWORD']}).encode(),
  headers={'apikey': anon, 'Content-Type': 'application/json'},
  method='POST')
with urllib.request.urlopen(req, timeout=60) as res:
  jwt=json.loads(res.read().decode())['access_token']

body={
  'message': 'How much did we sell today?',
  'shop_id': ow.get('STAGING_TEST_SHOP_ID') or None,
}
req=urllib.request.Request(
  base+'/functions/v1/ai-ask-waka',
  data=json.dumps(body).encode(),
  headers={
    'apikey': anon,
    'Authorization': f'Bearer {jwt}',
    'Content-Type': 'application/json',
  },
  method='POST')
with urllib.request.urlopen(req, timeout=120) as res:
  out=json.loads(res.read().decode())
# Redact potentially sensitive fields for console
safe={
  'ok': out.get('ok'),
  'success': out.get('success'),
  'tools_used': out.get('tools_used'),
  'data_as_of': out.get('data_as_of'),
  'usage': out.get('usage'),
  'answer_preview': (out.get('answer') or '')[:240],
  'error': out.get('error') or out.get('code'),
  'reason': out.get('reason'),
}
print(json.dumps(safe, indent=2))
PY
