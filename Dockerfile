# Minimal container for hosted MCP introspection (e.g. Glama).
#
# Glama spawns the container, drives the stdio MCP server through the
# `initialize` + `tools/list` handshake, and verifies the response. It
# does not invoke any tools, so no project needs to be attached.
#
# Local development should use `npm install -g agentmako` (or `npm link
# ./apps/cli` from a source checkout) instead of this image.

FROM node:20-slim

# Runtime dependencies for the native bindings agentmako loads at startup:
# - libsecret-1-0: required by @napi-rs/keyring for OS-keychain secret
#   storage. Introspection never opens the keychain, but the shared
#   library must exist for the napi binding to load.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 \
  && rm -rf /var/lib/apt/lists/*

# Install the published CLI globally so `agentmako` is on PATH.
RUN npm install -g agentmako@latest

# Default to the stdio MCP server. Glama will pipe MCP requests over
# stdin and read responses from stdout.
CMD ["agentmako", "mcp"]
