#!/bin/bash

# For mobile builds, we need to keep the files that post-build.sh deletes
# This script restores them from the SvelteKit build output

# Decompress the gzipped index.html
if [ -f public/index.html.gz ]; then
  gunzip -k public/index.html.gz
  # Remove the .gz file to avoid duplicate resources in Android
  rm public/index.html.gz
fi

# Copy the app directory and favicon back
cp -r .svelte-kit/output/client/_app public/
cp .svelte-kit/output/client/favicon.svg public/

echo "✓ Mobile build assets restored"
