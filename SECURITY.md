# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

### Do NOT

- Open a public GitHub issue
- Disclose the vulnerability publicly before it's fixed

### DO

1. **Email**: Send details to the project maintainers privately
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days

### After Resolution

- We will credit you in the security advisory (unless you prefer anonymity)
- We may offer recognition for significant vulnerabilities

## Security Best Practices for Contributors

1. **Never commit secrets** (API keys, passwords, tokens)
2. **Use environment variables** for sensitive configuration
3. **Validate all user input** on both client and server
4. **Follow the principle of least privilege**
5. **Keep dependencies updated** (run `npm audit` regularly)

## Known Security Considerations

### Authentication

- Guest sessions use temporary tokens
- Admin endpoints require authentication
- Rate limiting is enabled by default

### Data Protection

- Chat messages are moderated by AI
- User sessions expire automatically
- Sensitive data is never logged

### Infrastructure

- All production traffic should use HTTPS
- Database credentials should be unique per environment
- Redis should not be exposed publicly

### Audio Streaming

- Icecast admin panel should be protected
- Source passwords should be strong and unique
- Consider IP restrictions for streaming sources

## Security Headers

The application implements security headers including:

- Content Security Policy (CSP)
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy

## Dependency Security

We recommend running security audits regularly:

```bash
npm audit
npm audit fix
```

For critical vulnerabilities, update immediately and create a patch release.
