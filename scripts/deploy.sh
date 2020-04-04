#!/bin/bash

keyspace=$1
service=$2
dir=services/$service
cb="redis-cli -p 6380"
workdir=`pwd`/workdir

mkdir -p $workdir
pushd $dir
name=`cat spec.json | jq -r .name`
codeid=`cat $workdir/$service.hash`
cat $workdir/$service.build | $cb -x set ${keyspace}code/$codeid
$cb set ${keyspace}named/$name/code $codeid
cat spec.json | $cb -x set ${keyspace}named/$name
