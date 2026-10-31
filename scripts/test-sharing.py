#!/usr/bin/env python3
"""Exercise the real HTTP API with the course's alice/bob/carol accounts.

Requires a running backend, PostgreSQL and Keycloak. Only boards created by this
run are removed. Python's standard library is sufficient; tokens are never logged.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4


class Scenario:
    def __init__(self, args):
        self.args = args
        self.tokens = {}
        self.results = []
        self.created = set()

    def token(self, user):
        if user in self.tokens:
            return self.tokens[user]
        if self.args.signing_key:
            # Explicit opt-in for an isolated server trusting this ephemeral key.
            # This does not alter the application or disable signature verification.
            b64 = lambda data: base64.urlsafe_b64encode(data).rstrip(b'=').decode()
            now = int(time.time())
            claims = dict(iss=self.args.keycloak_url, aud='kanban-app', sub=user,
                          preferred_username=user, upn=user, iat=now, exp=now + 3600,
                          groups=['user'] + (['admin'] if user == 'carol' else []))
            message = b64(b'{"alg":"RS256","typ":"JWT"}') + '.' + b64(json.dumps(claims).encode())
            signature = subprocess.check_output(
                ['openssl', 'dgst', '-sha256', '-sign', str(self.args.signing_key)], input=message.encode())
            token = message + '.' + b64(signature)
        else:
            body = urlencode(dict(grant_type='password', client_id='kanban-app', username=user,
                                  password=os.environ.get(user.upper() + '_PASSWORD', user))).encode()
            request = Request(self.args.keycloak_url + '/protocol/openid-connect/token', data=body)
            try:
                with urlopen(request, timeout=20) as response:
                    token = json.load(response)['access_token']
            except HTTPError as error:
                raise RuntimeError(f'Keycloak login failed for {user}: HTTP {error.code}') from None
        self.tokens[user] = token
        return token

    def check(self, label, user, method, path, expected, body=None):
        headers = {'Content-Type': 'application/json'}
        if user:
            headers['Authorization'] = 'Bearer ' + self.token(user)
        request = Request(self.args.api_url + path, method=method, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(request, timeout=20) as response:
                status, data = response.status, response.read().decode()
        except HTTPError as response:
            status, data = response.code, response.read().decode()
        self.results.append(dict(label=label, user=user, method=method, path=path,
                                 expected=expected, actual=status))
        if status != expected:
            raise AssertionError(f'{label}: expected HTTP {expected}, received {status}: {data[:250]}')
        print(f'PASS {label} ({status})', flush=True)
        return json.loads(data) if data else None

    def create(self, user, name):
        board = self.check('Create ' + name, user, 'POST', '/boards', 201, {'name': name})
        self.created.add(board['id'])
        return board

    def delete(self, user, board_id):
        self.check('Delete test board', user, 'DELETE', f'/boards/{board_id}', 204)
        self.created.discard(board_id)

    def denied(self, label, user, board, column, card, target):
        base = f'/boards/{board}'
        actions = [
            ('GET', base, None), ('GET', base + '/members', None), ('GET', base + '/lists', None),
            ('POST', base + '/lists', {'name': 'Denied', 'position': 9}),
            ('GET', f'/lists/{column}', None),
            ('PUT', f'/lists/{column}', {'name': 'Denied', 'position': 0}),
            ('DELETE', f'/lists/{column}', None), ('GET', f'/lists/{column}/cards', None),
            ('POST', f'/lists/{column}/cards', {'title': 'Denied'}),
            ('GET', f'/cards/{card}', None), ('PUT', f'/cards/{card}', {'title': 'Denied'}),
            ('DELETE', f'/cards/{card}', None),
            ('PATCH', f'/cards/{card}/move', {'targetListId': target, 'position': 0}),
            ('PUT', base, {'name': 'Denied'}), ('DELETE', base, None),
            ('POST', base + '/members', {'username': 'carol'}),
            ('DELETE', base + '/members/bob', None)
        ]
        for method, path, body in actions:
            self.check(label + ' ' + method + ' ' + path, user, method, path, 403, body)

    def run(self):
        prefix = 'Sharing test ' + uuid4().hex[:8]
        self.check('Anonymous access denied', None, 'GET', '/boards', 401)
        shared = self.create('alice', prefix + ' shared')['id']
        private = self.create('alice', prefix + ' private')['id']
        own = self.create('bob', prefix + ' owned')['id']
        base = f'/boards/{shared}'
        columns = self.check('Owner reads columns', 'alice', 'GET', base + '/lists', 200)
        private_columns = self.check('Owner reads private columns', 'alice', 'GET', f'/boards/{private}/lists', 200)
        source, target = columns[0]['id'], columns[1]['id']
        private_column = private_columns[0]['id']
        card = self.check('Owner creates card', 'alice', 'POST', f'/lists/{source}/cards', 201, {'title': 'Existing'})['id']
        private_card = self.check('Owner creates private card', 'alice', 'POST', f'/lists/{private_column}/cards', 201, {'title': 'Private'})['id']
        self.denied('Unrelated user denied', 'bob', shared, source, card, target)
        assert self.check('No owner row in memberships', 'alice', 'GET', base + '/members', 200) == []
        for name in ['', ' ', 'x' * 121, 'alice']:
            self.check('Invalid/owner username rejected', 'alice', 'POST', base + '/members', 400, {'username': name})
        self.check('Missing username rejected', 'alice', 'POST', base + '/members', 400, {})
        self.check('Add member', 'alice', 'POST', base + '/members', 201, {'username': ' bob '})
        self.check('Duplicate rejected', 'alice', 'POST', base + '/members', 400, {'username': 'bob'})
        self.check('Owner cannot be removed', 'alice', 'DELETE', base + '/members/alice', 400)
        members = self.check('Member reads memberships', 'bob', 'GET', base + '/members', 200)
        assert [m['username'] for m in members] == ['bob']
        visible = self.check('Member lists owned and shared boards', 'bob', 'GET', '/boards', 200)
        visible_ids = {b['id'] for b in visible}
        assert {shared, own}.issubset(visible_ids) and private not in visible_ids
        assert [b['name'] for b in visible] == sorted(b['name'] for b in visible)
        all_ids = {b['id'] for b in self.check('Administrator sees all test boards', 'carol', 'GET', '/boards', 200)}
        assert {shared, private, own}.issubset(all_ids)
        self.check('Member opens board', 'bob', 'GET', base, 200)
        self.check('Member reads columns', 'bob', 'GET', base + '/lists', 200)
        self.check('Member reads column', 'bob', 'GET', f'/lists/{source}', 200)
        self.check('Member reads cards', 'bob', 'GET', f'/lists/{source}/cards', 200)
        self.check('Member reads card', 'bob', 'GET', f'/cards/{card}', 200)
        column = self.check('Member creates column', 'bob', 'POST', base + '/lists', 201, {'name': 'Extra', 'position': 3})['id']
        self.check('Member edits column', 'bob', 'PUT', f'/lists/{column}', 200, {'name': 'Edited', 'position': 2})
        added_card = self.check('Member creates card', 'bob', 'POST', f'/lists/{column}/cards', 201, {'title': 'New'})['id']
        self.check('Member edits card', 'bob', 'PUT', f'/cards/{added_card}', 200, {'title': 'Edited', 'description': 'Details'})
        moved = self.check('Member moves card', 'bob', 'PATCH', f'/cards/{added_card}/move', 200, {'targetListId': target, 'position': 0})
        assert moved['listId'] == target and moved['position'] == 0
        self.check('Cannot move into private board', 'bob', 'PATCH', f'/cards/{card}/move', 403, {'targetListId': private_column, 'position': 0})
        self.check('Cannot move out of private board', 'bob', 'PATCH', f'/cards/{private_card}/move', 403, {'targetListId': target, 'position': 0})
        assert self.check('Denied move preserves source', 'bob', 'GET', f'/cards/{card}', 200)['listId'] == source
        for method, path, body in [
            ('PUT', base, {'name': 'Denied'}), ('DELETE', base, None),
            ('PUT', base, {'name': ''}),
            ('POST', base + '/members', {}),
            ('POST', base + '/members', {'username': 'carol'}),
            ('DELETE', base + '/members/bob', None), ('DELETE', base + '/members/unknown', None)
        ]:
            self.check('Member cannot manage board', 'bob', method, path, 403, body)
        self.check('Admin reads memberships', 'carol', 'GET', base + '/members', 200)
        self.check('Admin renames board', 'carol', 'PUT', base, 200, {'name': prefix + ' admin rename'})
        self.check('Admin adds member', 'carol', 'POST', base + '/members', 201, {'username': 'carol'})
        self.check('Admin removes member', 'carol', 'DELETE', base + '/members/carol', 204)
        self.check('Remove bob', 'alice', 'DELETE', base + '/members/bob', 204)
        self.denied('Revoked session denied', 'bob', shared, source, card, target)
        assert shared not in {b['id'] for b in self.check('Revoked board disappears from list', 'bob', 'GET', '/boards', 200)}
        self.check('Restore membership', 'alice', 'POST', base + '/members', 201, {'username': 'bob'})
        self.check('Member deletes card', 'bob', 'DELETE', f'/cards/{added_card}', 204)
        self.check('Member deletes column', 'bob', 'DELETE', f'/lists/{column}', 204)
        self.check('Owner renames board', 'alice', 'PUT', base, 200, {'name': prefix + ' owner rename'})
        self.check('Owner cannot use a blank board name', 'alice', 'PUT', base, 400, {'name': ''})
        self.delete('alice', shared)
        self.check('Deleted board is absent', 'carol', 'GET', base, 404)
        self.delete('carol', private)
        self.delete('bob', own)

    def cleanup(self):
        failures = []
        for board_id in list(self.created):
            try:
                self.delete('carol', board_id)
            except (AssertionError, RuntimeError, URLError) as error:
                failures.append(str(error))
        if failures:
            raise RuntimeError('Cleanup failed: ' + '; '.join(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-url', default='http://localhost:9080/api')
    parser.add_argument('--keycloak-url', default='http://localhost:8081/realms/kanban')
    parser.add_argument('--signing-key', type=Path, help='Test-only private key; requires an isolated backend configured to trust it')
    parser.add_argument('--report', type=Path, help='Write status-code results as JSON, without tokens')
    args = parser.parse_args()
    args.api_url = args.api_url.rstrip('/')
    args.keycloak_url = args.keycloak_url.rstrip('/')
    scenario = Scenario(args)
    try:
        try:
            scenario.run()
        finally:
            scenario.cleanup()
    finally:
        if args.report:
            args.report.write_text(json.dumps(scenario.results, indent=2) + '\n')
    print(f'All {len(scenario.results)} HTTP checks passed; test boards cleaned up.')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, RuntimeError, URLError, OSError) as error:
        print('FAIL:', error, file=sys.stderr)
        sys.exit(1)
