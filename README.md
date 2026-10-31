# Kanban — Full-Stack Course Project

OpenLiberty (Jakarta EE 11 Web Profile + MicroProfile 7.1) + Angular 20 + PostgreSQL.

**The board is secured with Keycloak and MicroProfile JWT. Every board belongs
to its creator, who can share it with other users through BoardMember.**

## Exercise 17 — board sharing

Owners and administrators manage the board and its members. Members can work on
cards and columns, while renaming/deleting the board and changing membership
remain restricted. Removing a member revokes their access on the next request.

See [design, acceptance coverage and reproducible verification](docs/BOARD_SHARING.md).
The PR also runs the backend tests, Angular tests and production builds through
[GitHub Actions](.github/workflows/verify.yml).

## Layout

```
backend/     Jakarta EE 11 Web Profile + MicroProfile 7.1 on OpenLiberty
frontend/    Angular 20 (standalone components, signals) + Angular CDK + keycloak-js
keycloak/    kanban-realm.json — imported by the Keycloak container at startup
docker-compose.yml
```

## Running

### With a Dev Container (recommended for the course)

Students only need **Docker + VS Code** (or nothing at all with GitHub
Codespaces). Open the folder and run *Dev Containers: Reopen in Container*.
This starts PostgreSQL and Keycloak and gives you a shell with Java 21, Maven
and Node 22 already installed — no local toolchain to set up.

```bash
# inside the container, two terminals:
cd backend  && mvn liberty:dev     # http://localhost:9080, hot reload
cd frontend && npm install && npm start   # http://localhost:4200
```

See `.devcontainer/` for the configuration.

### With Docker Compose directly

```bash
# 1. database + Keycloak + backend
docker compose up -d --build postgres keycloak backend

# 2. frontend (separate terminal)
cd frontend
npm install      # first time only
npm start        # http://localhost:4200
```

Opening <http://localhost:4200> now redirects to Keycloak. Sign in as
`alice` / `alice` (see `keycloak/README.md` for the other accounts).

### Backend without Docker

```bash
docker compose up -d postgres keycloak
cd backend
# Liberty runs on the host, so Keycloak is at localhost:8081, not keycloak:8080
export MP_JWT_VERIFY_PUBLICKEY_LOCATION=http://localhost:8081/realms/kanban/protocol/openid-connect/certs
mvn liberty:dev          # http://localhost:9080, hot reload
```

## Endpoints

Every `/api` endpoint requires `Authorization: Bearer <token>` with the `user`
or `admin` realm role — no token is a **401**; a board outside the caller's
owned/shared boards is a **403** unless the caller is an administrator.

| Method | Path                     | Description                                   |
|--------|--------------------------|-----------------------------------------------|
| GET    | `/api/boards`            | Owned/shared boards (all for admins), sorted by name |
| POST   | `/api/boards`            | Create a board (+ "To do"/"Doing"/"Done")     |
| GET    | `/api/boards/{id}`       | One board                                     |
| PUT    | `/api/boards/{id}`       | Rename a board                                |
| DELETE | `/api/boards/{id}`       | Delete a board and its columns                |
| GET    | `/api/boards/{id}/members` | Members, visible to collaborators           |
| POST   | `/api/boards/{id}/members` | Add a username (owner/admin)                |
| DELETE | `/api/boards/{id}/members/{username}` | Remove a member (owner/admin)     |
| GET    | `/api/boards/{id}/lists` | Columns of a board, by position               |
| POST   | `/api/boards/{id}/lists` | Add a column                                  |
| GET    | `/api/lists/{id}`        | One column                                    |
| PUT    | `/api/lists/{id}`        | Rename / move a column                        |
| DELETE | `/api/lists/{id}`        | Delete a column and its cards                 |
| GET    | `/api/lists/{id}/cards`  | Cards of a column, by position                |
| POST   | `/api/lists/{id}/cards`  | Add a card (appended to the end)              |
| GET    | `/api/cards/{id}`        | One card                                      |
| PUT    | `/api/cards/{id}`        | Edit a card's title / description             |
| DELETE | `/api/cards/{id}`        | Delete a card                                 |
| PATCH  | `/api/cards/{id}/move`   | Move a card: `{ "targetListId", "position" }` |

Also available and left open on purpose (ops endpoints, not user data):
`/health/ready` (MicroProfile Health, checks PostgreSQL), `/openapi` and
`/openapi/ui` (MicroProfile OpenAPI), `/metrics`.

### Trying it with curl

The realm enables the password grant so a token can be fetched without a browser.
Run these commands from your host machine (not the Dev Container's integrated terminal) —
Ask **localhost:8081** for it — a token minted at `keycloak:8080`
carries the wrong `iss` and the backend rejects it.

**bash / curl**

```bash
TOKEN=$(curl -s http://localhost:8081/realms/kanban/protocol/openid-connect/token \
  -d grant_type=password -d client_id=kanban-app \
  -d username=alice -d password=alice | jq -r .access_token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:9080/api/boards
curl -X POST http://localhost:9080/api/boards \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"name":"Sprint 1"}'

# add a card to a column, then move it to another column at position 0
curl -X POST http://localhost:9080/api/lists/1/cards \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"title":"Write the README"}'
curl -X PATCH http://localhost:9080/api/cards/1/move \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"targetListId":2,"position":0}'

# without a token: 401
curl -i http://localhost:9080/api/boards

# what the backend sees in the token
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '{iss, aud, preferred_username, groups}'
```

**PowerShell**

```powershell
$resp = Invoke-RestMethod -Method Post `
    -Uri http://localhost:8081/realms/kanban/protocol/openid-connect/token `
    -Body @{ grant_type = "password"; client_id = "kanban-app"; username = "alice"; password = "alice" }
$TOKEN = $resp.access_token

Invoke-RestMethod -Uri http://localhost:9080/api/boards -Headers @{ Authorization = "Bearer $TOKEN" }
Invoke-RestMethod -Method Post -Uri http://localhost:9080/api/boards `
    -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType "application/json" `
    -Body '{"name":"Sprint 1"}'

# add a card to a column, then move it to another column at position 0
Invoke-RestMethod -Method Post -Uri http://localhost:9080/api/lists/1/cards `
    -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType "application/json" `
    -Body '{"title":"Write the README"}'
Invoke-RestMethod -Method Patch -Uri http://localhost:9080/api/cards/1/move `
    -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType "application/json" `
    -Body '{"targetListId":2,"position":0}'

# without a token: 401
try { Invoke-RestMethod -Uri http://localhost:9080/api/boards }
catch { $_.Exception.Response.StatusCode }

# what the backend sees in the token
$payload = $TOKEN.Split('.')[1].Replace('-', '+').Replace('_', '/')
$payload += '=' * ((4 - $payload.Length % 4) % 4)
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) |
    ConvertFrom-Json | Select-Object iss, aud, preferred_username, groups
```

## Notes on the stack

- **Jakarta Data 1.0** is new in Jakarta EE 11 and is part of the Web Profile,
  so `webProfile-11.0` alone is enough.
  The repositories (`BoardRepository`, `BoardListRepository`, `CardRepository`)
  are interfaces only — Liberty generates the implementation, derives the
  persistence unit from the `jdbc/kanban` data source, and creates the tables at
  startup.
- `BoardList` references its board by `boardId`, and `Card` references its column
  by `listId`, rather than by JPA associations: it keeps the repositories and the
  JSON flat.
- `Card.position` is a 0-based index within a column. `PATCH /api/cards/{id}/move`
  is the only endpoint that changes it: it renumbers the affected column(s) so
  positions stay contiguous. Deleting a card or column cascades in the resource
  layer (no `ON DELETE CASCADE`).
- CORS for `http://localhost:4200` is configured in `server.xml`, but the
  Angular dev server proxies `/api` to port 9080 (`frontend/proxy.conf.json`),
  so the browser stays single-origin. Keycloak is *not* proxied: the browser
  talks to `localhost:8081` directly, which is why the realm lists
  `http://localhost:4200` under `webOrigins`.
- **Security** — `@LoginConfig(authMethod = "MP-JWT")` on
  `KanbanApplication` puts the whole API behind bearer tokens; the issuer, the
  JWKS URL and the expected audience are plain MicroProfile Config properties in
  `microprofile-config.properties`, not Liberty-specific `server.xml` elements.
  `backend/.../security/` holds the two beans on top of that: `CurrentUser`
  (who is calling, are they an admin) and `BoardAccess` (does this board — or
  the board this column/card belongs to — belong to them).
- The backend reaches Keycloak at `keycloak:8080` while the browser reaches it
  at `localhost:8081`. The JWKS fetch uses the first, the `iss` claim in the
  token is the second: they are different URLs for the same server and both
  appear in `microprofile-config.properties`.
- On the Angular side, `src/app/auth/` mirrors the backend's `security/`
  package: `AuthService` (keycloak-js + signals), `authInterceptor` (adds the
  `Authorization` header and silently refreshes the token) and `authGuard`
  (redirects to the Keycloak login page). `BoardService` never mentions a token.
- Angular 20 is used; it requires Node >= 20.19 (or 22.12+). The Dev Container
  ships Node 22, so there is no host Node version to worry about.
