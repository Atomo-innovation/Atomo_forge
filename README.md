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

### Start Caddy (reverse proxy to Vite)

Install Caddy, then run it from the repo root (it will read `./Caddyfile`):

```sh
sudo apt-get install -y caddy
sudo caddy run --config ./Caddyfile
```

Now open `https://electron.local`.

## Make `electron.local` work on other devices (no `/etc/hosts`)

To make other devices on the same Wi‑Fi/LAN resolve `electron.local` automatically, use **mDNS** (Avahi/Bonjour) so your machine advertises itself as `electron.local`.

Run once on the host machine:

```sh
npm run lan:setup
```

Then, on other devices on the same network, open:

```text
http://electron.local
```

Note: for easiest cross-device access, use **HTTP** on LAN. HTTPS for `.local` requires trusting a local CA certificate on each device.

If you previously added `electron.local` into `/etc/hosts`, the setup script will remove that override (it breaks LAN access).

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
