/**
 * LAN / dev URL helpers (Node — used by auth-server, vite config, shell scripts).
 */
const os = require("os");
const { execSync } = require("child_process");

function getLanIPv4() {
  if (process.env.FORGE_LAN_IP && /^\d{1,3}(\.\d{1,3}){3}$/.test(process.env.FORGE_LAN_IP)) {
    return process.env.FORGE_LAN_IP;
  }
  try {
    const out = execSync("ip -4 route get 1.1.1.1 2>/dev/null", { encoding: "utf8", timeout: 2000 });
    const m = out.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g);
    if (m && m.length) return m[m.length - 1];
  } catch {
    /* ignore */
  }
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    if (/^(lo|docker|br-|veth|virbr)/i.test(name)) continue;
    for (const addr of ifaces[name] || []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

const ELECTRON_LOCAL_HTTP = "http://electron.local";

function isMdnsActive() {
  if (process.env.FORGE_MDNS_ACTIVE === "1") return true;
  if (process.env.FORGE_MDNS_ACTIVE === "0") return false;
  try {
    const out = execSync("systemctl is-active avahi-daemon 2>/dev/null", {
      encoding: "utf8",
      timeout: 1500,
    });
    return out.trim() === "active";
  } catch {
    return false;
  }
}

function getDevNetworkInfo() {
  const lanIp = getLanIPv4();
  const devHost = process.env.VITE_DEV_HOST || "electron.local";
  const devPort = Number(process.env.VITE_DEV_PORT || 8443) || 8443;
  const lanHttpUrl = lanIp ? `http://${lanIp}` : null;
  const mdnsActive = isMdnsActive();
  const electronLocalHttpUrl = ELECTRON_LOCAL_HTTP;
  const localHttpsUrl =
    process.env.FORGE_DEV_URL ||
    (process.env.FORGE_OPEN_NO_PORT === "1"
      ? `https://${devHost}/`
      : `https://${devHost}:${devPort}/`);

  const otherDevicesUrl =
    process.env.FORGE_OTHER_DEVICES_URL ||
    (mdnsActive ? electronLocalHttpUrl : lanHttpUrl);

  return {
    lanIp,
    lanHttpUrl,
    localHttpsUrl,
    mdnsActive,
    electronLocalHttpUrl,
    otherDevicesUrl,
    electronLocalNote: mdnsActive
      ? "Same Wi‑Fi: open http://electron.local on phones/tablets (use http, not https)."
      : "Run npm run lan:setup once on this PC, then other devices can open http://electron.local.",
  };
}

module.exports = { getLanIPv4, getDevNetworkInfo, isMdnsActive, ELECTRON_LOCAL_HTTP };

if (require.main === module) {
  const ip = getLanIPv4();
  if (ip) process.stdout.write(ip);
}
