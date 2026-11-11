/** Pozná technickou blokaci. Nezkouší ji obejít. */
export function detectPublicBlock(
  status: number,
  body: string,
  challengeHeader: string | null,
): string | null {
  if (challengeHeader?.toLowerCase() === "challenge") return "cloudflare-challenge";

  const head = body.slice(0, 8_000).toLowerCase();
  if (
    head.includes("just a moment") &&
    (head.includes("challenges.cloudflare.com") || head.includes("cdn-cgi/challenge"))
  ) {
    return "cloudflare-challenge";
  }
  if (head.includes("g-recaptcha") || head.includes("hcaptcha.com") || head.includes("cf-turnstile")) {
    return "captcha";
  }
  if (head.includes("request blocked") && head.includes("cloudfront")) return "cloudfront-block";
  if (head.includes('type="password"') && /log\s?in|přihl[aá]s|sign in/.test(head)) return "login-wall";
  if (status === 401 || status === 403 || status === 429) return `http-${status}`;
  return null;
}
