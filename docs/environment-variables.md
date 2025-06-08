# Environment Variables Configuration

This document describes the environment variables required for the Lofiever streaming services.

## Streaming Services

### Icecast Configuration

The following environment variables are used to configure Icecast authentication:

- `ICECAST_SOURCE_PASSWORD`: Password for source connections (default: `source_password`)
- `ICECAST_ADMIN_PASSWORD`: Password for admin access (default: `admin_password`)
- `ICECAST_RELAY_PASSWORD`: Password for relay connections (default: `relay_password`)
- `ICECAST_ADMIN_USER`: Admin username (default: `admin`)

### Liquidsoap Configuration

- `ICECAST_SOURCE_PASSWORD`: Password used by Liquidsoap to connect to Icecast as a source

## Setting Environment Variables

### For Development

Create a `.env` file in the project root with your custom values:

```bash
# Streaming Configuration
ICECAST_SOURCE_PASSWORD=your_secure_source_password
ICECAST_ADMIN_PASSWORD=your_secure_admin_password
ICECAST_RELAY_PASSWORD=your_secure_relay_password
ICECAST_ADMIN_USER=your_admin_username
```

### For Production

Set these environment variables in your deployment environment:

```bash
export ICECAST_SOURCE_PASSWORD="your_secure_source_password"
export ICECAST_ADMIN_PASSWORD="your_secure_admin_password"
export ICECAST_RELAY_PASSWORD="your_secure_relay_password"
export ICECAST_ADMIN_USER="your_admin_username"
```

## Security Notes

- **Never commit passwords to the repository**
- Use strong, unique passwords for each environment
- Consider using Docker secrets or a secrets management system for production
- The default values are only for development and should be changed for any public deployment

## Docker Compose

The `docker-compose.yml` file is configured to use these environment variables with fallback defaults for development. The services will automatically pick up the values from your `.env` file or system environment variables. 