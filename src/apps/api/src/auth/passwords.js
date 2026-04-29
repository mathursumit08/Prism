import crypto from "node:crypto";

const iterations = 210_000;
const keyLength = 64;
const digest = "sha512";

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");
  return `pbkdf2$${iterations}$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  const [algorithm, iterationValue, salt, expectedHash] = storedHash.split("$");
  if (algorithm !== "pbkdf2" || !iterationValue || !salt || !expectedHash) {
    return false;
  }

  const derived = crypto
    .pbkdf2Sync(password, salt, Number(iterationValue), keyLength, digest)
    .toString("hex");

  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expectedHash, "hex"));
}
