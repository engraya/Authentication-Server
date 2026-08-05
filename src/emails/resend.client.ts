/**
 * src/emails/resend.client.ts
 * ────────────────────────────────────────────────────────────────────
 * The single Resend client instance for the app (same singleton reasoning as
 * the Prisma client). Everything that sends email imports this.
 * ────────────────────────────────────────────────────────────────────
 */

import { Resend } from "resend";

import { config } from "../config";

export const resend = new Resend(config.email.resendApiKey);
