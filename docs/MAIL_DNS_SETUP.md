# 📧 DNS Records for usseo.one Mail — Add These in Cloudflare

**Server IP:** `95.111.242.23`

> ⚠️ For all **A/TXT/MX records**: set Cloudflare proxy to **DNS only (grey cloud)** — mail does not work through the orange-cloud proxy.

| # | Type | Name | Content | Priority | Proxy | TTL |
|---|------|------|---------|----------|-------|-----|
| 1 | A | `mail` | `95.111.242.23` | — | **DNS only** | Auto |
| 2 | MX | `@` | `mail.usseo.one` | **10** | DNS only | Auto |
| 3 | TXT | `@` | `v=spf1 mx a ip4:95.111.242.23 -all` | — | DNS only | Auto |
| 4 | TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:admin@usseo.one; adkim=s; aspf=s; pct=100` | — | DNS only | Auto |
| 5 | TXT | `mail._domainkey` | *(see step below — added after server generates the key)* | — | DNS only | Auto |
| 6 | CAA *(optional)* | `@` | `0 issue "letsencrypt.org"` | — | DNS only | Auto |

## After adding records 1–4, tell me and I'll:
1. Generate the **DKIM key** on the server → give you the exact value for record #5
2. Verify every record with live DNS lookups
3. Test deliverability end-to-end

## rDNS (reverse PTR) — one extra step, important for deliverability
Your VPS is at Contabo. The PTR currently points to `vmi3215787.contaboserver.net`.
Log into the Contabo panel → *Reverse DNS management* → set PTR of `95.111.242.23` to **`mail.usseo.one`**.
(Gmail/others reject mail from IPs whose PTR doesn't match sending hostname.)

## SPF note
If you later send email from other services (e.g. Zoho still active), replace record #3's content with a merged include version — I'll handle that when we get there.
