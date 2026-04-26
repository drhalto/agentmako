# services/api

Transport and control plane only.

Owns:

- HTTP endpoints
- local Streamable HTTP MCP transport
- auth and request validation
- response streaming

Must call into contracts and engine services rather than reimplement behavior.
