# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

## Run as `https://electron.local` (no port)

This project’s Vite dev server runs on `https://localhost:8443` by default. If you want to open it as `https://electron.local` **without** `:8443`, run a local reverse proxy on port 443.

### One-time: map `electron.local` to localhost

```sh
sudo sh -c 'echo "127.0.0.1 electron.local" >> /etc/hosts'
```

### Start dev server

```sh
npm run dev
```

### HTTPS on port 443 (`https://electron.local`)

`npm run dev` runs `scripts/ensure-caddy-for-dev.sh` in the same terminal: it reuses Caddy if port 443 is already up, otherwise runs `sudo systemctl start caddy` (or `sudo caddy run --config ./Caddyfile`). You may be prompted for your sudo password once.

Skip the proxy (Vite only): `FORGE_SKIP_CADDY=1 npm run dev` → open `https://electron.local:8443`.

Manual Caddy (second terminal) is only needed if you stopped the bundled helper and systemd:

```sh
sudo apt-get install -y caddy
sudo systemctl start caddy
```

Now open `https://electron.local` while `npm run dev` is running.

**`ERR_CONNECTION_REFUSED` on `https://electron.local` (no port)?** Vite listens on **`:8443`**, not **`:443`**. Open **`https://electron.local:8443`** or start Caddy once: `sudo systemctl start caddy`.

## Other devices (phone, tablet, another PC)

On the **same Wi‑Fi**, other users can type **`http://electron.local`** in the browser (not `https://`).

### One-time on the host PC

```sh
npm run lan:setup   # sudo — installs Avahi, publishes electron.local on the LAN
```

Then start the app:

```sh
npm run dev
```

`npm run dev` also tries to start Avahi automatically. In the app: **Settings → Open on other devices** shows the URL to copy.

**Fallback** if a device cannot resolve `.local` (some Android/Windows networks): use the LAN IP printed in the terminal, e.g. `http://192.168.1.30`.

**Do not use** `https://electron.local` on other devices unless you install/trust the local Caddy CA on each device.

This dev PC may still use `https://electron.local` via `/etc/hosts` (`127.0.0.1 electron.local`); that entry does not affect other devices.

**Firewall (Ubuntu):** if the phone cannot connect:

```sh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Keep `npm run dev` running on the host while other devices connect.

## Run ONLINE (public URL with trusted HTTPS)

To run this publicly on the internet you must use a **real domain** (example: `app.yourdomain.com`). `.local` only works for local networks and cannot be used as a public domain.

### On your server (VPS or your machine with public IP)

- **DNS**: point `app.yourdomain.com` to your server’s public IP
- **Firewall**: allow inbound TCP **80** and **443**
- **Backend**: run your existing API on port **3003** (DB code stays the same)

### Build and serve the frontend

```sh
npm ci
npm run build
```

### Run Caddy with production config

This repo includes a template: `./Caddyfile.prod`. Edit it and replace `app.yourdomain.com` with your domain, then:

```sh
sudo apt-get install -y caddy
sudo caddy run --config ./Caddyfile.prod
```

Now open `https://app.yourdomain.com` (no port).

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
# atomo-AI-models-
# atomo-AI-models-
# Atomo_forge
