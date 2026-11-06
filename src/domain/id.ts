const UUID_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/;

// 不用 crypto.randomUUID()：它只在 HTTPS / localhost 等安全上下文存在，
// 通过 http://IP 访问时为 undefined（iPhone 导入素材曾因此失败）。
// getRandomValues 没有这个限制，按 RFC 4122 拼出 UUID v4。
export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return hex.join("").replace(UUID_GROUPS, "$1-$2-$3-$4-$5");
}
