import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export async function verifyPassword(password: string, hashed: string) {
  if (!hashed) {
    return false;
  }

  if (hashed.startsWith("plain$")) {
    return password === hashed.slice(6);
  }

  const [algo, salt, storedHash] = hashed.split("$");
  if (algo !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(derived, "hex");
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
