#!/bin/sh
set -eu
docker build --target test -t careeros-intelligence-test backend/intelligence
docker run --rm --init --read-only --memory=512m --pids-limit=32 --tmpfs /tmp:size=64m careeros-intelligence-test
