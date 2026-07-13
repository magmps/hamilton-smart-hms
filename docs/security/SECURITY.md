# Security baseline

- HMAC-signed access tokens with expiration
- PBKDF2 password hashing with unique salts
- Role-based authorization
- API rate limiting and request-size limits
- Security response headers
- Audit events for privileged and financial actions
- No card number storage
- Environment-based secrets

Before production: set a strong `HMS_JWT_SECRET`, enable HTTPS, use PostgreSQL, configure backups, add MFA for privileged users, integrate a compliant payment provider, rotate demo passwords, and complete penetration testing.
