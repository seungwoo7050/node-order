#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
pg sh -c 'exec psql "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" -v ON_ERROR_STOP=1 "$@"' psql "$@"
