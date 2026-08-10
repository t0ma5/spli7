# OBSOLETE for the Cloudflare KV deploy path.
# Prefer `npm run deploy` / OpenNext + Wrangler instead of Docker + Postgres.
# This file is retained only for reference from upstream Spliit.

FROM node:21-alpine AS base
WORKDIR /usr/app
RUN echo "Docker/Postgres deploy is obsolete. Use Cloudflare Workers + KV." && exit 1
