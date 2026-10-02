# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private
reporting instead: open the **Security** tab of this repository and choose
**Report a vulnerability**.

Include what you found, how to reproduce it, and the Rewatch version. You will get a
reply as soon as the maintainer can, usually within a week.

## Scope and known limits

Rewatch is built for personal use on your own machine or home network.

- It has **no login**. Do not expose it directly to the internet. Put it behind Cloudflare
  Access, a VPN or an authenticating reverse proxy.
- The SSRF check resolves DNS once before yt-dlp fetches the page, so it cannot fully stop
  DNS-rebinding or redirect tricks. This is documented in the README.
- Jobs are held in memory and the server runs a single worker.

Reports about these documented limits are welcome as ideas, but they are not treated as
vulnerabilities.
