# Keycloak realm

`kanban-realm.json` is imported at startup by the `keycloak` service
(`start-dev --import-realm` mounts this directory as `data/import`). Nothing has
to be clicked in the admin console for the course to work.

Admin console: <http://localhost:8081> — `admin` / `admin` (the *master* realm,
unrelated to the accounts below).

## What is in it

| Realm | `kanban` |
|---|---|
| Client | `kanban-app` — public, authorization code + PKCE (S256) |
| Redirect URIs | `http://localhost:4200/*` |
| Realm roles | `user`, `admin` |
| Access token lifespan | 5 minutes |

### Accounts

| Username | Password | Roles | |
|---|---|---|---|
| `alice` | `alice` | `user` | sees her own boards and those shared with her |
| `bob` | `bob` | `user` | sees his own boards and those shared with him |
| `carol` | `carol` | `user`, `admin` | sees every board |

### The two protocol mappers that matter

Both are on the `kanban-app` client and both exist to make the token acceptable
to MicroProfile JWT — this is the part that is easy to get wrong.

- **realm roles as groups** (`oidc-usermodel-realm-role-mapper`) — Keycloak puts
  realm roles in `realm_access.roles`, but MicroProfile JWT reads roles from the
  `groups` claim. Without this mapper every `@RolesAllowed` check in the backend
  returns 403.
- **kanban-app audience** (`oidc-audience-mapper`) — by default a token only
  carries `aud: account`, which `mp.jwt.verify.audiences=kanban-app` rejects.

`sslRequired` is `none` and `directAccessGrantsEnabled` is on so tokens can be
fetched with `curl` (see the root `README.md`). Both are course conveniences,
not production settings.

## Changing it

Edit the JSON and recreate the container — an existing realm is *not*
re-imported over, so restarting is not enough:

```bash
docker compose rm -sf keycloak && docker compose up -d keycloak
```

`start-dev` keeps realm data in an embedded database inside the container, and
no volume is mounted, so recreating the container wipes it. That is deliberate:
this file stays the single source of truth, and anything clicked together in the
admin console is lost unless it is written back here.
