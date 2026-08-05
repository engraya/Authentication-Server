/**
 * src/services/email.service.ts
 * ────────────────────────────────────────────────────────────────────
 * The boundary between our app and Resend. It renders a template and sends it,
 * translating Resend's result into a simple success/failure our callers handle.
 *
 * Design choice: sending is BEST-EFFORT for signup — a transient email outage
 * shouldn't fail a registration (the user can request a resend). So this
 * returns a boolean and logs, rather than throwing, and callers decide.
 * In DEVELOPMENT we also log the link so you can test the flow without an inbox.
 * ────────────────────────────────────────────────────────────────────
 */

import { resend } from "../emails/resend.client";
import { verificationEmail, passwordResetEmail } from "../emails/templates";
import { config } from "../config";
import { logger } from "../utils/logger";

export const emailService = {
  /** Send the email-verification message. Returns true on success. */
  async sendVerificationEmail(params: {
    to: string;
    name?: string | null;
    link: string;
  }): Promise<boolean> {
    // Dev convenience: print the link so the flow is testable without an inbox
    // (and without depending on Resend's test-mode recipient restrictions).
    if (!config.isProduction) {
      logger.info(`[email] Verification link for ${params.to}: ${params.link}`);
    }

    // Coerce a missing name to null so it satisfies the template's string|null.
    const content = verificationEmail({ name: params.name ?? null, link: params.link });

    const { data, error } = await resend.emails.send({
      from: config.email.from,
      to: params.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });

    if (error) {
      // Log and report failure; do NOT throw (best-effort for signup).
      logger.warn(`[email] Failed to send verification to ${params.to}: ${error.message}`);
      return false;
    }

    logger.info(`[email] Verification sent to ${params.to} (id ${data?.id ?? "?"})`);
    return true;
  },

  /** Send the password-reset message. Returns true on success. */
  async sendPasswordResetEmail(params: {
    to: string;
    name?: string | null;
    link: string;
  }): Promise<boolean> {
    if (!config.isProduction) {
      logger.info(`[email] Password-reset link for ${params.to}: ${params.link}`);
    }

    const content = passwordResetEmail({ name: params.name ?? null, link: params.link });

    const { data, error } = await resend.emails.send({
      from: config.email.from,
      to: params.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });

    if (error) {
      logger.warn(`[email] Failed to send reset to ${params.to}: ${error.message}`);
      return false;
    }

    logger.info(`[email] Password-reset sent to ${params.to} (id ${data?.id ?? "?"})`);
    return true;
  },
};
