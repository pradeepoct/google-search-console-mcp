import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const fakeSA = {
  type: "service_account",
  project_id: "fake-project",
  private_key_id: "fake-key-id",
  private_key: privateKey,
  client_email: "smoke-test@fake-project.iam.gserviceaccount.com",
  client_id: "0",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://example.invalid",
};

const bearer = randomBytes(32).toString("hex");

const lines = [
  `GOOGLE_SERVICE_ACCOUNT_JSON='${JSON.stringify(fakeSA).replace(/'/g, "\\'")}'`,
  `MCP_BEARER_TOKEN=${bearer}`,
  "",
];

writeFileSync(".dev.vars", lines.join("\n"), "utf8");
console.log("BEARER:" + bearer);
