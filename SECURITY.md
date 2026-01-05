# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Lofiever seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **DO NOT** open a public issue for security vulnerabilities
2. Email the maintainer directly at your security contact or use GitHub's private vulnerability reporting
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Response Time**: We aim to respond within 48 hours
- **Updates**: We'll keep you informed of our progress
- **Credit**: If you'd like, we'll credit you in our release notes

### Scope

The following are in scope for security reports:

- Authentication and authorization issues
- Data exposure vulnerabilities
- Cross-site scripting (XSS)
- SQL injection
- Server-side request forgery (SSRF)
- Remote code execution
- Denial of service vulnerabilities

### Out of Scope

- Issues in dependencies (report these to the dependency maintainers)
- Social engineering attacks
- Physical security issues
- Issues requiring physical access to a user's device

## Security Best Practices

When contributing to Lofiever, please follow these security guidelines:

### Environment Variables

- Never commit secrets or API keys
- Use `.env.example` as a template without real values
- Rotate credentials if accidentally exposed

### Dependencies

- Keep dependencies up to date
- Review dependency changes in PRs
- Use `npm audit` to check for known vulnerabilities

### Code Review

- All PRs require review before merging
- Security-sensitive changes require additional scrutiny
- Use parameterized queries for database operations
- Sanitize user input before processing

## Security Features

Lofiever implements the following security measures:

- **Rate Limiting**: API endpoints are rate-limited to prevent abuse
- **Input Validation**: All user input is validated using Zod schemas
- **Authentication**: NextAuth.js for secure session management
- **CORS**: Configured to allow only trusted origins
- **Content Security**: DOMPurify for HTML sanitization in chat

## Acknowledgments

We appreciate the security research community and thank all researchers who responsibly disclose vulnerabilities.

---

Thank you for helping keep Lofiever and our users safe!
