# Mobile verification API

`migration.sql` provisions the mobile tables in the Neon database referenced by `DEVELOPER_DATABASE_URL`. Mobile JWTs have a separate issuer/audience from financial JWTs and developer keys. A verified Twilio challenge creates a revocable, server-backed session. No demo OTP is accepted here.

Required: `JWT_SECRET` (at least 32 characters), `DEVELOPER_DATABASE_URL`, `CRON_SECRET`, the three `TWILIO_*` credentials, and `TWILIO_STRICT_WHATSAPP_FALLBACK_CONFIRMED=true` after provider confirmation. Phone identifiers use HMAC; personal fields use randomized AES-256-GCM with a purpose-specific key derived from JWT_SECRET. Rotating JWT_SECRET requires migrating encrypted personal fields first; changing it directly makes old records unreadable and invalidates sessions.

`/mobile/otp/start` and `/mobile/otp/status/:id` implement WhatsApp first and SMS only for Twilio error 63024, including asynchronous delivery-attempt errors. Other errors fail closed. Challenges expire after ten minutes, permit five verification attempts and are single-use. Rate limits persist in the database.

Residence routes implement the user-approved 15-day/12-day, 50-metre accuracy/100-metre radius policy with consent and a two-hour home window. The server checks timestamps, mock flags, calendar days and duplicates. Device coordinates are evidence, not independently attested identity/address. `/mobile/account` deletes the authenticated user's residence, phone challenges and all sessions in one transaction. No other account can be selected in the request.

Vercel runs `/mobile/retention` daily with CRON_SECRET; it deletes enrollments older than 29 days so the daily cadence stays within the 30-day retention limit. Monitor cron success before enabling real collection. Reports contain no raw location samples, expire after 30 days and state their verification limitations. Copies exported by the person are outside server retention.

The OpenAPI contract and interactive documentation include mobile endpoints. The automated coding lab blocks OTP start/verify operations to prevent unintended outbound messaging; developers can use the explicit request console for manual testing with their own consenting test numbers.
