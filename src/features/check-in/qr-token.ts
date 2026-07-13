export function decodeSelfCheckInToken(value: string) {
  const token = value.trim();

  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}
