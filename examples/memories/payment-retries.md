---
name: payment-retries
description: Payment retry handling and idempotency tests in the fictional demo shop.
---

# Payment retries

The demo shop associates each payment request with an idempotency key.
When changing retry behavior, check that retrying the same key does not create
another payment. Verify the current implementation before relying on this note.
