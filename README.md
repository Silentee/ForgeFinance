# Forge Finance

A personal finance app for tracking income, spending, investments, debt, and net worth.
Runs entirely on your local network — your data never leaves your machines.

---

## Prerequisites

Before running Forge Finance, install the following dependencies:

### 1. uv (Python package manager)

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**Mac / Linux:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

After installing, **open a new terminal** so the PATH is updated.

Verify installation:
```bash
uv --version
```

### 2. Node.js (v18 or higher)

Download and install from: https://nodejs.org/

Verify installation:
```bash
node --version
```

---

## Quick Start (Windows)

The easiest way to run Forge Finance on Windows:

1. Open a terminal in the project root directory
2. Run:
   ```
   start.bat
   ```

This will:
- Start the backend in a new terminal window (port 8000)
- Start the frontend in the current window (port 5173)
- Automatically open your browser to http://localhost:5173

To stop the app, close both terminal windows.

---

## First-Time Setup

1. Start the app — the backend auto-creates the database and seeds default categories on first run
2. Open http://localhost:5173
3. Go to **Accounts** → add your checking, savings, credit cards, investments, etc.
4. Go to **Import** → upload a CSV from your bank to populate transactions
5. Go to **Budget** → set monthly spending targets per category
6. Go to **Dashboard** for your overview

---

## Self-Hosting Guide

Forge Finance can be self-hosted on another machine on your local network (e.g., a Raspberry Pi, home server, or always-on PC). There are two deployment modes:

### Mode 1: Backend Only (Remote Backend, Local Frontend)

Run the backend on a server while running the frontend on your local machine. This is useful when you want the database on a central server but prefer the faster development experience of running the frontend locally.

#### On the Server (e.g., 192.168.1.100)

1. Clone/copy the project to the server

2. Edit `backend/start.bat` (Windows) or `backend/start.sh` (Linux/Mac) to bind to all network interfaces:

   Change:
   ```
   --host 127.0.0.1
   ```
   To:
   ```
   --host 0.0.0.0
   ```

3. Add your local machine's origin to CORS. Edit `backend/app/core/config.py`:
   ```python
   cors_origins: list[str] = [
       "http://localhost:5173",
       "http://localhost:3000",
       "http://localhost:8080",
       "http://192.168.1.50:5173",  # Add your local machine's IP
   ]
   ```

4. Start the backend:
   ```bash
   cd backend
   ./start.sh   # or start.bat on Windows
   ```

5. Verify the API is accessible from your local machine:
   ```
   http://192.168.1.100:8000/docs
   ```

#### On Your Local Machine

1. Set the API URL environment variable before starting the frontend:

   **Windows (cmd):**
   ```cmd
   set VITE_API_BASE_URL=http://192.168.1.100:8000
   cd frontend
   start.bat
   ```

   **Windows (PowerShell):**
   ```powershell
   $env:VITE_API_BASE_URL = "http://192.168.1.100:8000"
   cd frontend
   .\start.bat
   ```

   **Mac / Linux:**
   ```bash
   VITE_API_BASE_URL=http://192.168.1.100:8000 ./start.sh
   ```

2. Open http://localhost:5173

---

### Mode 2: Full Stack (Both Backend and Frontend on Server)

Run both the backend and frontend on a server, accessing it from any device on your network.

#### On the Server (e.g., 192.168.1.100)

1. Clone/copy the project to the server

2. **Configure the backend** to accept connections from all interfaces:

   Edit `backend/start.bat` or `backend/start.sh`:
   ```
   --host 0.0.0.0
   ```

3. **Configure CORS** to allow connections from any device on your network. Edit `backend/app/core/config.py`:
   ```python
   cors_origins: list[str] = [
       "http://localhost:5173",
       "http://192.168.1.100:5173",  # Server's own IP
       "http://192.168.1.0/24:5173", # Or use a wildcard for your subnet
   ]
   ```

   Or for development, allow all origins (not recommended for production):
   ```python
   cors_origins: list[str] = ["*"]
   ```

4. **Configure the frontend** to connect to the backend and accept external connections:

   Edit `frontend/vite.config.ts`:
   ```typescript
   server: {
     port: 5173,
     host: '0.0.0.0',  // Add this line to accept external connections
     proxy: {
       '/api': {
         target: 'http://localhost:8000',  // Backend on same machine
         changeOrigin: true,
       },
     },
   },
   ```

5. **Start both services:**

   **Terminal 1 — Backend:**
   ```bash
   cd backend
   ./start.sh
   ```

   **Terminal 2 — Frontend:**
   ```bash
   cd frontend
   ./start.sh
   ```

#### On Any Device on Your Network

Open your browser and navigate to:
```
http://192.168.1.100:5173
```

Replace `192.168.1.100` with your server's actual IP address.

---

### Mode 3: Docker on Raspberry Pi (Portainer or Docker Compose)

Run Forge Finance as Docker containers on a Raspberry Pi (or any always-on Linux box). The app is served on port `8080`; the backend runs behind nginx and is not exposed directly.

#### Prerequisites on the Raspberry Pi

1. **Raspberry Pi OS** (64-bit recommended) with SSH access

2. **Docker** — install via the convenience script:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```
   Log out and back in for the group change to take effect.

3. **Optional: Portainer** — install the Community Edition container:
   ```bash
   docker volume create portainer_data
   docker run -d -p 8000:8000 -p 9443:9443 --name portainer --restart=always \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v portainer_data:/data \
     portainer/portainer-ce:latest
   ```
   Access Portainer at `https://<pi-ip>:9443` and create an admin account.

#### Option A: Deploy with Portainer (web UI)

1. **Get the code onto the Pi.** Either clone the repo or copy the project files:
   ```bash
   git clone <your-repo-url> ~/ForgeFinance
   ```

2. **Open Portainer** → `https://<pi-ip>:9443`

3. **Create a Stack:**
   - Go to **Stacks** → **Add stack**
   - Name: `forge-finance`
   - Choose **Repository** (if using Git) or **Upload** (paste the compose file)
   - If using **Repository**, point to your repo and set the compose path to `docker-compose.yml`
   - If using **Web editor**, paste the contents of `docker-compose.yml`
   - Click **Deploy the stack**

4. **Wait for the build** — the first build takes several minutes on a Pi (especially the frontend npm install). You can watch progress in the stack's container logs within Portainer.

5. **Access Forge Finance** from any device on your network:
   ```
   http://<pi-ip>:8080
   ```

#### Option B: Deploy via SSH + `docker compose` (no Portainer)

1. Copy the repo to the Pi (example uses `scp`):
   ```bash
   scp -r ./ForgeFinance pi@<pi-ip>:~/ForgeFinance
   ```

2. SSH in and build/run:
   ```bash
   ssh pi@<pi-ip>
   cd ~/ForgeFinance
   docker compose up -d --build
   ```

3. Open:
   ```
   http://<pi-ip>:8080
   ```

#### Building ARM Images on Your PC (Fastest Deploys)

Building on a Pi can be slow. If your development machine is x86, use `buildx` to build `linux/arm64` images and push them to a registry (Docker Hub, GHCR, etc.):

```bash
# One-time setup
docker buildx create --use --name forgefinance-builder
docker buildx inspect --bootstrap

# Build and push ARM64 images (replace <your-registry>)
docker buildx build --platform linux/arm64 -t <your-registry>/forge-backend:latest ./backend --push
docker buildx build --platform linux/arm64 -t <your-registry>/forge-frontend:latest ./frontend --push
```

Then update the Portainer stack (or `docker-compose.yml`) to use image references instead of `build:`:

```yaml
services:
  backend:
    image: <your-registry>/forge-backend:latest
    # ... (same volumes, environment, restart)
  frontend:
    image: <your-registry>/forge-frontend:latest
    # ... (same ports, depends_on, restart)
```

#### Migrating Your Existing Database (Optional)

If you already have data locally, you can migrate your `backend/app.db` to the Pi.

1. Copy your local DB to the Pi:
   ```bash
   scp ./backend/app.db pi@<pi-ip>:~/app.db
   ```

2. Start the stack once so the `forge-data` volume exists:
   ```bash
   ssh pi@<pi-ip>
   cd ~/ForgeFinance
   docker compose up -d --build
   ```

3. Stop the backend and copy the DB into the volume via the backend container:
   ```bash
   docker compose stop backend
   docker cp ~/app.db $(docker compose ps -q backend):/data/app.db
   docker compose start backend
   ```

#### Data & Backups

- All database and upload data lives in the `forge-data` Docker volume (mounted at `/data` in the backend container).
- Back up the database:
  ```bash
  docker cp $(docker compose ps -q backend):/data/app.db ./app.db.backup
  ```
- Restore the database:
  ```bash
  docker compose stop backend
  docker cp ./app.db.backup $(docker compose ps -q backend):/data/app.db
  docker compose start backend
  ```
- If you need the on-disk volume path on the Pi:
  ```bash
  docker volume ls
  docker volume inspect -f '{{.Mountpoint}}' <compose-project>_forge-data
  ```

#### Updating

- **Portainer**: **Stacks** → `forge-finance` → **Pull and redeploy** (images) or **Update the stack** (build).
- **SSH + compose**: copy the updated code again, then:
  ```bash
  docker compose up -d --build
  ```

Rebuild only one service:
```bash
docker compose up -d --build backend
docker compose up -d --build frontend
```

#### Troubleshooting Docker/Pi

- **Build fails with out-of-memory**: Pi models with 1 GB RAM may struggle. Add a swap file:
  ```bash
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **Port 8000 conflict with Portainer**: Portainer may use port 8000, but Forge Finance does not publish the backend port (nginx proxies it), so it is not affected. If you choose to expose the backend, map it to a different host port (e.g., `8001:8000`).
- **Container won't start**: check logs in Portainer, or run:
  ```bash
  docker compose ps
  docker compose logs -f
  docker compose logs backend --tail=50
  ```
- **Slow performance**: a Pi 4/5 with 2 GB+ RAM is recommended; a USB SSD is much faster than an SD card.

---

### Firewall Notes

If you can't connect from other devices, ensure your firewall allows incoming connections:

**Windows:**
```powershell
# Allow backend (port 8000)
netsh advfirewall firewall add rule name="Forge Finance Backend" dir=in action=allow protocol=tcp localport=8000

# Allow frontend (port 5173)
netsh advfirewall firewall add rule name="Forge Finance Frontend" dir=in action=allow protocol=tcp localport=5173
```

**Linux (ufw):**
```bash
sudo ufw allow 8000/tcp
sudo ufw allow 5173/tcp
```

---

## Features

- **Dashboard** — net worth KPIs, recent transactions, account summary
- **Accounts** — track checking, savings, HYSA, credit cards, investments, real estate, vehicles
- **Transactions** — browse, search, categorize, and filter all transactions
- **Budget** — set monthly targets per category, track actual vs. budgeted
- **Reports** — spending trends, net worth history, liquidity, equity tracking, cash flow
- **Import** — drag-and-drop CSV upload with presets for major US banks

---

## Supported CSV Formats (Import Presets)

| Preset | Institution |
|--------|-------------|
| `chase_checking` | Chase Bank (checking) |
| `chase_credit` | Chase credit cards |
| `bank_of_america` | Bank of America |
| `wells_fargo` | Wells Fargo |
| `capital_one` | Capital One |
| `american_express` | American Express |
| `fidelity` | Fidelity Investments |
| `schwab_checking` | Charles Schwab checking |
| `generic` | Most other banks (standard columns) |

Re-uploading the same file is always safe — duplicates are detected and skipped.

---

## Project Structure

```
ForgeFinance/
├── backend/                   # FastAPI + SQLite
│   ├── app/
│   │   ├── api/endpoints/     # Route handlers
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── services/          # Business logic (CSV import, reports)
│   │   └── db/                # Session, init, migrations
│   ├── pyproject.toml         # uv-managed dependencies
│   ├── start.bat / start.sh   # Startup scripts
│   └── app.db             # SQLite database (created on first run)
│
├── frontend/                  # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/             # Dashboard, Accounts, Transactions, Budget, Reports, Import
│   │   ├── components/        # Layout (Sidebar) + UI primitives
│   │   ├── hooks/             # TanStack Query hooks
│   │   ├── lib/               # API client, services, formatters
│   │   └── types/             # TypeScript types matching backend schemas
│   ├── start.bat / start.sh   # Startup scripts
│   └── package.json
│
└── start.bat                  # One-click launcher (Windows)
```

---

## Tech Stack

- **Backend**: Python, FastAPI, SQLAlchemy, SQLite, Pandas, uv
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts

---

## Troubleshooting

### "uv is not installed or not on PATH"
Open a **new terminal** after installing uv. The PATH update requires a fresh terminal session.

### "Cannot connect to backend from another machine"
1. Check the backend is running with `--host 0.0.0.0`
2. Verify CORS origins include the connecting machine's address
3. Check firewall rules allow the port

### "CORS error in browser console"
Add the origin URL (e.g., `http://192.168.1.50:5173`) to `cors_origins` in `backend/app/core/config.py` and restart the backend.

### Database location
The SQLite database is created at `backend/app.db` on first run. Back up this file to preserve your data.
