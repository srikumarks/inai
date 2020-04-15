$(shell mkdir -p workdir static)
db := redis-cli -p 6380
services := $(shell cat boot.json | jq -r '.start[]')
service_bdeps := $(patsubst %,workdir/%.bdeps,$(services))
service_targets := $(patsubst %,workdir/%.build,$(services))
service_hashes := $(patsubst %,workdir/%.hash,$(services))
services_deployed := $(patsubst %,workdir/%.deployed,$(services))
keyspace := $(shell cat boot.json | jq -r '.boot[0].config.keyspace')


all: workdir/.createdir static/inai_web.min.js $(services_deployed) workdir/assets_deployed 

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

static/inai_web.js: $(shell browserify --list src/client.js)
	browserify src/client.js > $@

static/inai_web.min.js : static/inai_web.js
	uglifyjs --source-map --output $@ $<
	
include $(service_bdeps)

workdir:
	-mkdir -p workdir

$(service_bdeps): workdir/%.bdeps: services/%/index.js
	echo $@ : `browserify --list $<` > $@

workdir/pid: services/redis_codebase/redis.conf
	@echo Starting codebase server ...
	@-$(db) shutdown
	@redis-server $<

$(service_targets): workdir/%.build: workdir/%.bdeps
	browserify $(patsubst workdir/%.bdeps,services/%/index.js,$<) > $@
	uglifyjs --source-map --output $@.min $@

$(service_hashes): workdir/%.hash: workdir/%.build
	shasum $< | awk '{print $$1}' > $@

$(services_deployed): workdir/%.deployed: workdir/%.hash services/%/spec.json workdir/pid
	@echo Deploying $(patsubst workdir/%.hash,%,$<)
	@./scripts/deploy.sh $(keyspace) $(patsubst workdir/%.hash,%,$<) > /dev/null
	@touch $@

workdir/assets_deployed: workdir/pid services/app/template.html $(services_deployed)
	@shasum services/app/template.html | awk '{print $$1}' > workdir/tmp.hash
	@cat services/app/template.html | $(db) -x set $(keyspace)assets/`cat workdir/tmp.hash`
	@$(db) set $(keyspace)assets/`cat workdir/tmp.hash`/meta/type text/html
	@$(db) set $(keyspace)named/app/assets/template.html `cat workdir/tmp.hash`
	@rm workdir/tmp.hash
	@touch $@

clean:
	@echo Shutting down redis
	@-$(db) shutdown
	@echo Cleaning work directory
	@rm -rf workdir
	@rm -f static/inai_web.js
	@mkdir -p workdir
