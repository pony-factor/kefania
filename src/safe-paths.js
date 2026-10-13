// Keep content from sensitive paths out of AI prompts and public review comments.
export function secretPath(filename) {
  return /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519|ecdsa)|[^/]+\.(?:pem|p12|pfx|key))$/i.test(filename)
    || /(^|\/)(?:\.ssh|\.aws|\.gnupg)\//i.test(filename);
}
