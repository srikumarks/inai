$(shell mkdir -p workdir static)
browserify = npx browserify
uglifyjs = npx uglifyjs
minify = --minify
db := redis-cli -p 6380
shasum := sha1sum
services := $(shell cat boot.json | jq -r '.start[]')
service_bdeps := $(patsubst %,workdir/%.bdeps,$(services))
service_targets := $(patsubst %,workdir/%.build,$(services))
service_hashes := $(patsubst %,workdir/%.hash,$(services))
services_deployed := $(patsubst %,workdir/%.deployed,$(services))
keyspace := $(shell cat boot.json | jq -r '.boot[0].config.keyspace')


all: workdir/.createdir services/tailwind/styles.css static/inai_web.js.gz $(services_deployed)

build: workdir/.createdir services/tailwind/styles.css static/inai_web.js.gz $(service_hashes)

services/tailwind/styles.css: services/tailwind/styles-src.css
	npx postcss services/tailwind/styles-src.css -o services/tailwind/styles.css

workdir/.createdir:
	mkdir -p workdir
	touch workdir/.createdir

test:
	@echo services = $(services)
	@echo service_bdeps = $(service_bdeps)
	@echo service_targets = $(service_targets)
	@echo service_hashes = $(service_hashes)
	@echo services_deployed = $(services_deployed)
	@echo keyspace = $(keyspace)

static/inai_web.js: $(shell $(browserify) --list src/client.js)
	npx esbuild src/client.js $(minify) --bundle --outfile=$@
#	$(browserify) src/client.js > $@

static/inai_web.js.gz: static/inai_web.js static/css/bulma.css $(service_hashes)
	gzip -f -k static/inai_web.js
# 	$(uglifyjs) static/inai_web.js | gzip - > static/inai_web.js.gz

static/css/bulma.css: sass/styles.scss
	npm run css-build
	
redis: workdir/pid

workdir/_db:
	@-$(db) info > workdir/_db 

workdir/pid: services/redis_codebase/redis.conf
	@echo Starting codebase server ...
	@-$(db) shutdown
	@redis-server $<

include $(service_bdeps)

workdir:
	-mkdir -p workdir

$(service_bdeps): workdir/%.bdeps: services/%/index.js
	echo $@ : `$(browserify) --list $<` > $@

$(service_targets): workdir/%.build: workdir/%.bdeps
	npx esbuild $(patsubst workdir/%.bdeps,services/%/index.js,$<) --platform=$(shell jq -r '{"server":"node","browser":"browser"}[.env[0]]' $(patsubst workdir/%.bdeps,services/%/spec.json,$<)) --bundle $(minify) --outfile=$@
#	$(browserify) $(patsubst workdir/%.bdeps,services/%/index.js,$<) > $@

$(service_hashes): workdir/%.hash: workdir/%.build
	$(shasum) $< | awk '{print $$1}' > $@

$(services_deployed): workdir/%.deployed: workdir/%.hash services/%/spec.json workdir/_db
	@echo Deploying $(patsubst workdir/%.hash,%,$<)
	@./scripts/deploy.sh $(keyspace) $(patsubst workdir/%.hash,%,$<) > /dev/null
	@touch $@

clean:
ifneq (,$(wildcard workdir/pid))
	@echo Shutting down redis
	@-$(db) shutdown
endif
	@echo Cleaning work directory
	@rm -rf workdir
	@rm -f static/inai_web.js
	@mkdir -p workdir
