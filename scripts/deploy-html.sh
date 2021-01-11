#!/bin/bash
# $1 is the service name
# $2 is the asset file name

db="redis-cli -p 6380"
keyspace=`cat boot.json | jq -r '.boot[0].config.keyspace'`

hash=`shasum services/$1/$2 | awk '{print $1}'`
echo \($keyspace\) $1/$2 hash = "$hash"
cat services/$1/$2 | $db -x set ${keyspace}assets/$hash
$db set ${keyspace}assets/$hash/meta/type text/html
$db set ${keyspace}named/$1/assets/$2 $hash
echo Deployed services/$1/$2
