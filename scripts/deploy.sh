#!/bin/bash

# Eventually, this deploy script, including the deploy_asset()
# function here, should be available as an API call within
# redis_codebase. This script is, therefore, a temporary arrangement
# so that things like redis_codebase itself can be deployed.
# Chicken and egg problem indeed!

# The keyspace is expected to end in a '/' character so that
# it can be used as a straightforward prefix. Both keyspace
# and name are not expected to have spaces in them .. the general
# constraint being they be treated like identifiers in common
# programming languages.
shopt -s expand_aliases
alias shasum=sha1sum
keyspace=$1
service=$2
dir=services/$service

# "cb" stands for "codebase". In our case, the codebase is stored
# in a redis instance.
cb="redis-cli -p 6380"
workdir=`pwd`/workdir

mkdir -p $workdir
pushd $dir

name=`cat spec.json | jq -r .name`

deploy_asset() {
    local keyspace=$1
    local service=$2
    local name=$3
    local file=$4
    local type=$5
    local hash
    hash=`shasum $file | awk '{print $1}'` 

    echo \($keyspace\) Deploying $name/$file ... hash = "$hash"
    cat $file | $cb -x set ${keyspace}assets/$hash
    $cb set ${keyspace}assets/$hash/meta/type $type
    $cb set ${keyspace}named/$name/assets/$file $hash
    echo Deployed $name/$file at services/$service/$file
}

# Deploy README.md as an asset if present.
# The README will be delivered when a /_doc
# 'get' query is made to the service, with
# {{ref}} replaced with the name of the service.
# Below, we deploy other assets declared in the
# spec.json, but we treat README.md as something
# special that doesn't require configuration while
# it is otherwise on the same footing as the other
# assets.
if test -f "README.md"; then
    deploy_asset $keyspace $service $name README.md text/markdown
fi

# Deploy any other asset file listed under the
# assets field in spec.json which is expected to
# contain an array of objects with 'file' and 'type'
# fields .. like shown below -
# 
# "assets": [
#    { "file": "somefile.html", "type": "text/html" },
#    { "file": "someotherfile.md", "type": "text/markdown" }
# ]
if cat spec.json | jq -r -e .assets; then
    assets=(`cat spec.json | jq -r '.assets[].file'`)
    types=(`cat spec.json | jq -r '.assets[].type'`)

    # "${!assets[@]}" produces the keys of the array, which we can
    # use to index into the assets and types arrays since they're
    # expected to be of the same length.
    for i in "${!assets[@]}"; do (
        deploy_asset $keyspace $service $name ${assets[$i]} ${types[$i]}
    ) done
fi

codeid=`cat $workdir/$service.hash`
cat $workdir/$service.build | $cb -x set ${keyspace}code/$codeid
$cb set ${keyspace}named/$name/code $codeid
cat spec.json | $cb -x set ${keyspace}named/$name
