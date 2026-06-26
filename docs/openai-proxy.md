# OpenAI Proxy

The OpenAI-compatible proxy is intended to sit in front of an existing agent stack.

Initial scaffold behavior:

- Responds with a JSON payload compatible with a service health check.
- Provides a target surface for later request translation and skill injection.
