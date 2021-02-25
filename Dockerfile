# Relies on DOCKER_BUILDKIT=1 environment variable being set.
FROM node:15.10.0-alpine3.13 as builder

RUN apk --update add --no-cache --virtual .gyp python3 python2 make gcc g++
RUN apk add redis bash jq

WORKDIR /inai

COPY package*.json yarn.lock boot.json Makefile ./
COPY scripts ./scripts/
COPY services ./services/
COPY sass ./sass/
RUN mkdir static
RUN mkdir workdir

# Relies on DOCKER_BUILDKIT=1 environment variable being set.
# This lets us share the yarn cache between builds.
RUN --mount=type=cache,target=/root/.yarn YARN_CACHE_FOLDER=/root/.yarn yarn install
# RUN npm ci --only=production

RUN make build

FROM node:15.10.0-alpine3.13 as app

RUN apk --update add redis bash jq make
WORKDIR /inai

COPY --from=builder /inai/node_modules ./node_modules
COPY --from=builder /inai/workdir ./workdir
COPY . .

EXPOSE 8080 9090 6380
ENTRYPOINT ./scripts/start


