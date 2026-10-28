# MeetOrbit hosting

Configured 28 October 2026.

- Website: https://meetorbit.io
- Additional hostname: https://www.meetorbit.io
- Starter URL: https://meetorbit-73x9i.ondigitalocean.app
- DigitalOcean App Platform app: `meetorbit`, ID `146d870f-e07f-4609-a90c-b715b69ebe72`.
- GitHub repository: `sfandetti/meetorbit`, branch `main`.
- Component: `meetorbit-website`, **Static Site**.
- Source directory: `website`; output directory: `.`; no build command.
- Auto-deploy from GitHub main is enabled.
- Base price shown at creation: **$0.00/month**. This is the account's second static-site app within its first-three-free allowance.
- Adds 1 GiB outbound allowance; transfer is pooled across the team. Extra outbound transfer is currently $0.02/GiB. Porkbun domain renewal is separate.

## DNS

DNS remains at Porkbun; nameservers and email settings were not migrated. The root uses an ALIAS to the starter hostname. `www` uses a CNAME to the same hostname. Both records have TTL 600. DigitalOcean manages HTTPS certificates for these hostnames.

## Updates

Edit the static files under `website/` and submit a reviewed change to main. DigitalOcean redeploys that branch. Source changes do not change an installed Orbit on someone's PC; users must deliberately obtain and run updates.

Main branch protection requires one approved pull-request review and blocks force pushes and branch deletion. The owner retains the administrator override.

Pricing reference: https://docs.digitalocean.com/products/app-platform/details/pricing/
