# Relies on DOCKER_BUILDKIT=1 environment variable being set.
FROM node:15.10.0-alpine3.13 as builder

RUN apk --update add --no-cache --virtual .gyp python3 python2 make gcc g++
RUN apk add redis bash jq

RUN mkdir /inai && chown -R node:node /inai
WORKDIR /inai

COPY --chown=node:node package*.json yarn.lock boot.json Makefile ./

# Relies on DOCKER_BUILDKIT=1 environment variable being set.
# This lets us share the yarn cache between builds.
RUN --mount=type=cache,target=/root/.yarn3 YARN_CACHE_FOLDER=/root/.yarn3 yarn install
# RUN npm ci --only=production

RUN chown -R node:node /inai
USER node

COPY --chown=node:node scripts ./scripts/
COPY --chown=node:node services ./services/
COPY --chown=node:node sass ./sass/
COPY --chown=node:node src ./src/
RUN mkdir static
RUN mkdir workdir
RUN make build

FROM node:15.10.0-alpine3.13 as app

RUN apk --update add redis bash jq make
RUN mkdir /inai && chown -R node:node /inai
WORKDIR /inai

USER node

COPY --chown=node:node --from=builder /inai/node_modules ./node_modules
COPY --chown=node:node --from=builder /inai/workdir ./workdir
COPY --chown=node:node . .

EXPOSE 8080 9090 6380
ENTRYPOINT ./scripts/start


