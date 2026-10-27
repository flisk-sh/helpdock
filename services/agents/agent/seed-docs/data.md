# Local data: where it lives, how to reset, seed and snapshot

How the shared Postgres behaves under Flisk. Every command below was run against a real `postgres:16-alpine` container named the way Flisk names it. `flisk up` itself was not run for this page.

## Where the data lives

Flisk runs **one** Postgres container for the whole project. The generated `DATABASE_URL` of a service points at a database named after the project and the **stack**, so the services of one stack share a database.

| Thing | Name | Example for project `my-shop`, stack `store` |
| --- | --- | --- |
| Container | `<project>_postgres` | `my_shop_postgres` |
| Superuser | `<project>` | `my_shop` |
| Password | `DB_PASSWORD` in the project `.env` | |
| Database | `<project>_<stack>` (read from the generated `DATABASE_URL`) | `my_shop_store` |
| Volume | `database-management_<project>_postgres_data` | `database-management_my_shop_postgres_data` |
| Host port | `15432`, or `FLISK_POSTGRES_PORT` | |

`<project>` is `project.name` from `.flisk/project.json` with `-` replaced by `_`. The same rule applies to the stack name. The volume name was read from existing volumes on a machine that had run Flisk (for example `database-management_auth_user_postgres_data` for project `auth-user`), so check yours with `docker volume ls | grep postgres_data`. The database name was read from the generated Compose `DATABASE_URL` (for project `pilot`, stack `shop`: `.../pilot_shop`), not from a running container: list the real ones with `docker exec <container> psql -U <user> -d postgres -c '\l'`.

## Does it survive `flisk down`?

Yes. `flisk down` runs `tilt down`, which removes the containers but not named volumes. Checked with a small Compose project run through `tilt down`: the container was removed and the file in the volume was still there afterwards. The next `flisk up` starts Postgres on the same volume. Since [#585](https://github.com/flisk-sh/flisk/pull/585) `flisk down` also stops this project's `tilt up`, and `flisk down --prune-networks` removes the project's Docker networks that no container uses; by the source it touches networks only, not volumes (not run against Docker here). Without that flag the networks are kept.

## Start from a clean state

Everything, all services:

```bash
flisk down
docker volume rm database-management_my_shop_postgres_data
flisk up
```

One stack's database (Postgres must be running; `WITH (FORCE)` disconnects the service first):

```bash
docker exec my_shop_postgres psql -U my_shop -d postgres -c "DROP DATABASE my_shop_store WITH (FORCE)"
docker exec my_shop_postgres createdb -U my_shop -O my_shop my_shop_store
```

The database comes back empty. Migrations run again only when your migrator runs again (`flisk up`, or restart the migrator resource in Tilt).

## Seed

Pick one:

- **A SQL file, by hand.** Fast and fine for a pilot:

  ```bash
  docker exec -i my_shop_postgres psql -U my_shop -d my_shop_store -v ON_ERROR_STOP=1 < seed.sql
  ```

- **A one-shot resource.** Run the seed as a bring-your-own job with `--restart no`, the same way as a migration; see [One-shot jobs](byo.md#one-shot-jobs-migrations-seeders). A dbmate job was checked through a real `flisk up`. That a seed job runs after the migrator and before the API is **not checked here**; make the seed idempotent so a different order is harmless.

Keep seed data fake. Do not put production data in the repository.

### Worked example: a seed job

This is a bring-your-own job that loads two fake rows and exits. It follows the [one-shot job pattern](byo.md#one-shot-jobs-migrations-seeders), and [`examples/byo-jobs/atlas`](../examples/byo-jobs/atlas/README.md) is the checked job it is modelled on. Put these four files in `services/store/seed-demo/`.

`seed.sql` creates a small table if it is missing, then inserts fake rows and skips any that already exist, so running it again changes nothing. In a real project your migrator creates the table; then delete the `create table` statement.

```sql
-- Fake data only. Safe to run again: the table is created if missing and existing rows are skipped.
create table if not exists demo_customers (
  id integer primary key,
  name text not null,
  email text not null unique
);

insert into demo_customers (id, name, email) values
  (1, 'Test Customer One', 'customer1@example.test'),
  (2, 'Test Customer Two', 'customer2@example.test')
on conflict do nothing;
```

`seed.sh` reads the `DATABASE_URL` that Flisk passes to the job and refuses a database name that has anything other than letters, digits and underscores (Flisk's names only use those), so the name is safe to put in SQL. It then waits for Postgres, for at most 30 one-second tries (set `SEED_WAIT_TRIES` to change that), and exits with the last connection error if Postgres never answers. Then it creates the database if it is missing (Flisk does not create it for a bring-your-own job) and runs `seed.sql`:

```sh
#!/bin/sh
set -eu
url="${DATABASE_URL%%\?*}"   # drop the Prisma-style ?schema=public that psql rejects
db="${url##*/}"
server="${url%/*}"
case "$db" in
  ""|*[!A-Za-z0-9_]*) echo "seed: database name '$db' must use only letters, digits and underscores" >&2; exit 1 ;;
esac
export PGSSLMODE=disable     # Flisk's Postgres has SSL off
tries=0
max="${SEED_WAIT_TRIES:-30}"
until err=$(psql "$server/postgres" -tAc "select 1" 2>&1 >/dev/null); do
  tries=$((tries + 1))
  if [ "$tries" -ge "$max" ]; then echo "seed: Postgres not ready after $max tries: $err" >&2; exit 1; fi
  sleep 1
done
psql "$server/postgres" -tAc "select 1 from pg_database where datname = '$db'" | grep -q 1 \
  || psql "$server/postgres" -c "create database \"$db\""
exec psql "$url" -v ON_ERROR_STOP=1 -f /seed.sql
```

`Dockerfile` installs `psql` and runs the script:

```dockerfile
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
RUN apk add --no-cache postgresql-client
COPY seed.sql seed.sh /
RUN addgroup -g 1000 app && adduser -u 1000 -G app -D -H app
USER app
HEALTHCHECK NONE
CMD ["sh", "/seed.sh"]
```

Register it from that folder. `--restart no` is what makes it a one-shot job:

```bash
flisk resource seed-demo --type bring-your-own --stack store --dockerfile ./Dockerfile --restart no --register-existing --yes
```

That writes the `service.json` below. Add the `dependsOn` line yourself so the job waits for the shared Postgres; if a migrator creates your tables, list the migrator instead (a migrator already depends on `postgres`). The job does not listen on `port`, so `healthCheckPath` is not used.

```json
{
  "$schema": "https://flisk.sh/schema.service.json",
  "schemaVersion": 1,
  "appName": "seed-demo",
  "appType": "bring-your-own",
  "stack": "store",
  "port": 4000,
  "healthCheckPath": "/health",
  "dockerfile": "./Dockerfile",
  "restart": "no",
  "dependsOn": ["postgres"]
}
```

Restart behaviour: with `"restart": "no"` Docker does not start the container again after it exits `0`. Without it the default is `unless-stopped`, and the finished job would be started again and again. To run the seed a second time, restart the `seed-demo` resource in Tilt.

Run it and check the rows (names for project `my-shop`, as in the tables above):

```bash
flisk up store
docker ps -a --filter name=seed-demo --format '{{.Names}}\t{{.Status}}'      # expect "Exited (0)"
docker exec my_shop_postgres psql -U my_shop -d my_shop_store -c "select id, name from demo_customers order by id"
```

You should see the two `Test Customer` rows. After restarting the resource, the same two rows remain.

Not checked here: running this through a real `flisk up` (no Docker or Tilt available). The checked parts are `seed.sql` against a real Postgres (the second run leaves the same two rows), the shell syntax and URL handling of `seed.sh`, and the manifest against the service schema and `flisk config verify`. The Dockerfile and the `psql` calls follow the checked Atlas job.

## Snapshot and restore

```bash
# snapshot one database
docker exec my_shop_postgres pg_dump -U my_shop -Fc my_shop_store > store.dump

# restore it over the current state
docker exec -i my_shop_postgres pg_restore -U my_shop -d my_shop_store --clean --if-exists --no-owner < store.dump
```

Both were run: after a restore, a row inserted after the snapshot was gone. A shared team snapshot is just that file; Flisk has no command for it, and no tooling to scrub production data. Anonymise a dump before it leaves production.

## Not covered

- Other databases (MySQL, Mongo, Turso): only the shared Postgres was checked.
- A built-in `flisk db reset` or `flisk db seed` command does not exist.
- The start-up order between migrator, seed and API. Related, and still open: [#531](https://github.com/flisk-sh/flisk/issues/531) (an explicit, validated `dependsOn` on Postgres).
