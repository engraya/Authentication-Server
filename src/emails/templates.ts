/**
 * src/emails/templates.ts
 * ────────────────────────────────────────────────────────────────────
 * Email content builders. Each returns { subject, html, text } — we always
 * include a PLAIN-TEXT version alongside HTML (multipart) so the email renders
 * in clients that block HTML and improves deliverability/accessibility.
 *
 * Templates are pure functions (data in → strings out): no sending, no I/O.
 * That keeps them trivial to unit-test and reuse.
 * ────────────────────────────────────────────────────────────────────
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** The password-reset email: a link to choose a new password. */
export function passwordResetEmail(params: { name?: string | null; link: string }): EmailContent {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";
  return {
    subject: "Reset your password",
    text: [
      greeting,
      "",
      "We received a request to reset your password. Open the link below to choose a new one:",
      params.link,
      "",
      "This link expires in 1 hour and can be used once. If you didn't request this, you can safely ignore this email — your password won't change.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#111">
        <h2 style="margin:0 0 16px">Reset your password</h2>
        <p style="margin:0 0 12px">${greeting}</p>
        <p style="margin:0 0 20px">We received a request to reset your password. Click below to choose a new one.</p>
        <p style="margin:0 0 24px">
          <a href="${params.link}"
             style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
            Reset password
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#555">Or paste this link into your browser:</p>
        <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${params.link}">${params.link}</a></p>
        <p style="margin:0;font-size:12px;color:#888">This link expires in 1 hour and can be used once. If you didn't request this, ignore this email — your password won't change.</p>
      </div>
    `.trim(),
  };
}

/** The verification email: a friendly message with a one-click link. */
export function verificationEmail(params: { name?: string | null; link: string }): EmailContent {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";
  return {
    subject: "Verify your email address",
    text: [
      greeting,
      "",
      "Welcome! Please verify your email address by opening the link below:",
      params.link,
      "",
      "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#111">
        <h2 style="margin:0 0 16px">Verify your email</h2>
        <p style="margin:0 0 12px">${greeting}</p>
        <p style="margin:0 0 20px">Welcome! Please confirm your email address to activate your account.</p>
        <p style="margin:0 0 24px">
          <a href="${params.link}"
             style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">
            Verify email
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#555">Or paste this link into your browser:</p>
        <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${params.link}">${params.link}</a></p>
        <p style="margin:0;font-size:12px;color:#888">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
      </div>
    `.trim(),
  };
}
