# packages/sdk

Public extension surface.

Rules:

- extensions depend on the SDK, not on service internals
- new extension seams are additive by default
- core should not need extension-specific edits to accept a new adapter
