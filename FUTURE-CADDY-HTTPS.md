# Future step: drop the `:8080` port via Caddy (+ HTTPS note)

## Context

Remote access is already solved: a UniFi Local DNS record makes the app reachable at `http://pi.home:8080` both at home and over the Teleport VPN. This document is a **parked, optional future step** — not something to do now.

Two things you might revisit later:
1. Reach the app at `http://pi.home` with **no `:8080`**.
2. Add **HTTPS**.

Both are best handled by putting a **Caddy** reverse proxy in front of the app. UniFi can't do this itself (its port forwarding is WAN→LAN only, with no host-based reverse proxy for internal LAN traffic), so the proxy runs on the Pi. DNS stays as-is (`pi.home` → Pi IP); Caddy just turns port‑80/443 requests into the app on 8080.

Deployment reference: on the Pi the app runs via Docker Compose ([`docker-compose.yml`](docker-compose.yml)) — an nginx container serves the built React app (published on host `8080`) and proxies `/api` to the backend container internally.

---

## Option: Caddy reverse proxy (drops the port)

1. Add a `caddy` service to [`docker-compose.yml`](docker-compose.yml) and **remove** the frontend's `ports:` block so Caddy is the only entry point:
   ```yaml
     caddy:
       image: caddy:2
       ports:
         - "80:80"
         # - "443:443"   # uncomment when adding HTTPS
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile
         - caddy-data:/data      # persists certs when you enable HTTPS
       depends_on:
         - frontend
       restart: unless-stopped

     frontend:
       build: ./frontend
       # ports:            # <-- delete; Caddy now fronts it
       #   - "8080:80"
       depends_on:
         - backend
       restart: unless-stopped
   ```
   Add `caddy-data:` under the top-level `volumes:` key.

2. Create `Caddyfile` in the repo root:
   ```
   http://pi.home {
       reverse_proxy frontend:80
   }
   ```
   (Caddy reaches `frontend:80` over the compose network; the existing nginx still serves the app and proxies `/api` to the backend.)

3. `docker compose up -d --build` → app is now at `http://pi.home` with no port.

*Alternative:* **Nginx Proxy Manager** — same idea with a web admin UI instead of a config file (add a "Proxy Host": `pi.home` → `frontend:80`). Prefer it if you want point-and-click over editing files.

---

## Note on HTTPS exposure

Today the app is plain **HTTP**, meaning your login password, auth token, and financial data travel in **plaintext on the wire**. What that actually exposes:

- **On your home LAN:** reading that plaintext requires an attacker **already on your network** actively sniffing (e.g. a compromised device doing ARP spoofing). Wi‑Fi is WPA-encrypted over the air, so the realistic risk is a malicious/compromised LAN device — **low but non-zero** on a trusted home network.
- **Over Teleport (remote):** WireGuard **already encrypts the entire tunnel** across the internet. So even on HTTP, remote traffic is encrypted end-to-end to your home network; the only plaintext hop is inside your LAN. Your finance data is **not** exposed in the clear on the public internet.

**Verdict:** HTTP is reasonable for this trusted-LAN + VPN setup. HTTPS is defense-in-depth (closes the compromised-LAN-device gap), not urgent.

### If/when you add HTTPS (via the Caddy step above)
With a real domain, Caddy can auto-fetch a fully-trusted **Let's Encrypt** cert using a **DNS-01 challenge** — no public exposure needed. Add the domain + your DNS-provider block to the `Caddyfile`, uncomment `443:443`, and Caddy handles issuance and renewal automatically. This is the cleanest path to warning-free HTTPS. (Without a domain, the alternative is a **mkcert**/self-signed cert with the local CA installed on each device.)
