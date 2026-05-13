#!/bin/bash
# update_uvtools_version.sh
# Usage: ./update_uvtools_version.sh

set -e

COMMIT_COUNT=$(git rev-list --count HEAD)
COMMIT_HASH=$(git rev-parse --short HEAD)
VERSION="v7.6.${COMMIT_COUNT}.${COMMIT_HASH}"

# Update the version string in UVTools/index.html
sed -i -E "s/UVTools v7\.6\.[0-9a-zA-Z.]+/UVTools ${VERSION}/" UVTools/index.html

echo "Updated UVTools version to ${VERSION} in UVTools/index.html"
