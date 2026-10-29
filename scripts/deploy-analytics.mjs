// Requires SSH host trust and non-interactive sudo already configured.
// Credentials travel through SSH stdin straight into systemd encrypted storage.
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { parse } from "dotenv";
const host = process.env.ANALYTICS_SSH_HOST || "ubuntu@212.64.11.71";
const ssh = (command, input) =>
  execFileSync("ssh", ["-o", "BatchMode=yes", host, command], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
if (ssh("hostname").trim() !== "VM-0-15-ubuntu")
  throw new Error("Unexpected server");
const vars = parse(readFileSync(".env", "utf8"));
if (!vars.ANALYTICS_TOKEN) throw new Error("ANALYTICS_TOKEN required");
if (!vars.ANALYTICS_INGEST_TOKEN) {
  vars.ANALYTICS_INGEST_TOKEN = randomBytes(32).toString("hex");
  appendFileSync(
    ".env",
    `\nANALYTICS_INGEST_TOKEN=${vars.ANALYTICS_INGEST_TOKEN}\n`,
  );
}
const version = new Date()
  .toISOString()
  .replace(/[^0-9]/g, "")
  .slice(0, 14);
const directory = "/opt/poor-map-analytics/versions/" + version;
ssh(`set -eu
getent passwd poor-map-analytics >/dev/null || sudo useradd --system --home /var/lib/poor-map-analytics --shell /usr/sbin/nologin poor-map-analytics
sudo install -d -m 755 ${directory} /etc/poor-map-analytics
sudo install -d -m 700 -o poor-map-analytics -g poor-map-analytics /var/lib/poor-map-analytics
sudo install -d -m 700 /var/backups/local-services/poor-map-analytics/${version}
if test -e /etc/credstore.encrypted/poor-map-analytics.env; then sudo cp /etc/credstore.encrypted/poor-map-analytics.env /var/backups/local-services/poor-map-analytics/${version}/analytics.env.encrypted; fi`);
const archive = execFileSync("tar", [
  "-czf",
  "-",
  "analytics",
  "worker/analytics.mjs",
  "src/telemetry-schema.ts",
]);
ssh(`sudo tar -xzf - --no-same-owner -C ${directory}`, archive);
const credential = `ANALYTICS_TOKEN=${vars.ANALYTICS_TOKEN}\nANALYTICS_INGEST_TOKEN=${vars.ANALYTICS_INGEST_TOKEN}\n`;
ssh(
  "sudo systemd-creds encrypt --name=analytics.env - /etc/credstore.encrypted/poor-map-analytics.env >/dev/null",
  credential,
);
ssh(`set -eu
sudo chmod 600 /etc/credstore.encrypted/poor-map-analytics.env
if test -L /opt/poor-map-analytics/current; then readlink /opt/poor-map-analytics/current | sudo tee /var/backups/local-services/poor-map-analytics/${version}/previous-version >/dev/null; fi
sudo ln -sfn ${directory} /opt/poor-map-analytics/current
sudo cp ${directory}/analytics/poor-map-analytics.service /etc/systemd/system/poor-map-analytics.service
sudo systemctl daemon-reload
sudo systemctl enable poor-map-analytics >/dev/null
sudo systemctl restart poor-map-analytics
for i in 1 2 3 4 5; do if curl --noproxy '*' -fsS http://127.0.0.1:3160/health >/dev/null; then exit 0; fi; sleep 1; done
exit 1`);
ssh(
  "sudo tee /opt/poor-map-analytics/INSTALL.json >/dev/null",
  JSON.stringify(
    {
      name: "poor-map-analytics",
      version: "1.0.0",
      release: directory,
      runtime: ssh("/usr/bin/node --version").trim(),
      service: "poor-map-analytics.service",
      listener: "127.0.0.1:3160",
      database: "/var/lib/poor-map-analytics/events.sqlite",
      credentials: "/etc/credstore.encrypted/poor-map-analytics.env",
      https: "https://stats.gongfpp.icu/poor-map",
      retentionDays: 30,
      server_sha256: createHash("sha256")
        .update(readFileSync("analytics/server.mjs"))
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    service: "poor-map-analytics",
    version,
    host: "VM-0-15-ubuntu",
    credentials: "systemd encrypted",
  }),
);
