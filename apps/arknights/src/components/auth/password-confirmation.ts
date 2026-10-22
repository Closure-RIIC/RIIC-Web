export function passwordConfirmationError(password: string, confirmation: string): string | null {
  if (!confirmation) return "请再次输入密码。";
  return password === confirmation ? null : "两次输入的密码不一致。";
}
