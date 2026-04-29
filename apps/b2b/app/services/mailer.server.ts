import nodemailer from "nodemailer";
import { ServerClient as PostmarkClient } from "postmark";
import db from "../db.server";

type EmailPayload = {
  shopId: string;
  type: string;
  to: string;
  data: Record<string, string>;
};

let queueTicking = false;
const prisma = db as any;

/**
 * Queue-first email API.
 * Call sites should enqueue, not block request/response waiting for SMTP/provider.
 */
export async function sendEmailTemplate(input: EmailPayload) {
  const job = await prisma.emailJob.create({
    data: {
      shopId: input.shopId,
      type: input.type,
      to: input.to,
      data: input.data,
      status: "PENDING"
    }
  });

  await prisma.emailLog.create({
    data: {
      jobId: job.id,
      shopId: input.shopId,
      type: input.type,
      to: input.to,
      status: "QUEUED",
      attempts: 0
    }
  });

  scheduleQueueProcessor();
  return { success: true, queued: true, jobId: job.id };
}

function scheduleQueueProcessor() {
  if (queueTicking) return;
  queueTicking = true;
  setTimeout(async () => {
    try {
      await processEmailQueueBatch();
    } finally {
      queueTicking = false;
    }
  }, 0);
}

export async function processEmailQueueBatch(limit = 20) {
  const jobs = await prisma.emailJob.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() }
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  for (const job of jobs) {
    const locked = await prisma.emailJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 } }
    });
    if (locked.count === 0) continue;

    const fresh = await prisma.emailJob.findUnique({ where: { id: job.id } });
    if (!fresh) continue;

    try {
      const payload = {
        shopId: fresh.shopId,
        type: fresh.type,
        to: fresh.to,
        data: (fresh.data || {}) as Record<string, string>
      };
      const delivered = await deliverTemplatedEmail(payload);

      await prisma.emailJob.update({
        where: { id: fresh.id },
        data: {
          status: "SENT",
          provider: delivered.provider,
          providerMsgId: delivered.providerMessageId || null,
          lastError: null
        }
      });
      await prisma.emailLog.create({
        data: {
          jobId: fresh.id,
          shopId: fresh.shopId,
          type: fresh.type,
          to: fresh.to,
          status: "SENT",
          provider: delivered.provider,
          providerMsgId: delivered.providerMessageId || null,
          attempts: fresh.attempts
        }
      });
    } catch (error: any) {
      const message = error?.message || "Email delivery failed";
      const exhausted = fresh.attempts >= fresh.maxAttempts;
      const backoffMinutes = Math.min(60, Math.max(1, fresh.attempts * 2));
      const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await prisma.emailJob.update({
        where: { id: fresh.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          nextAttemptAt,
          lastError: message
        }
      });
      await prisma.emailLog.create({
        data: {
          jobId: fresh.id,
          shopId: fresh.shopId,
          type: fresh.type,
          to: fresh.to,
          status: "FAILED",
          error: message,
          attempts: fresh.attempts
        }
      });
      console.error(`[Email Failed] ${fresh.type} to ${fresh.to}: ${message}`);
    }
  }
}

async function deliverTemplatedEmail({ shopId, type, to, data }: EmailPayload) {
  const template = await db.emailTemplate.findFirst({
    where: { shopId, type, isActive: true }
  });
  if (!template) {
    throw new Error(`Template disabled or not found: ${type}`);
  }

  let parsedSubject = template.subject;
  let parsedBody = template.body;

  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\[${key}\\]`, "g");
    parsedSubject = parsedSubject.replace(regex, value || "");
    parsedBody = parsedBody.replace(regex, value || "");
  }

  const htmlBody = parsedBody.replace(/\n/g, "<br/>");
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM_EMAIL || `"B2B Wholesale" <no-reply@example.com>`;

  // Preferred provider for multi-tenant scale.
  if (process.env.POSTMARK_SERVER_TOKEN) {
    const client = new PostmarkClient(process.env.POSTMARK_SERVER_TOKEN);
    const response = await client.sendEmail({
      From: from,
      To: to,
      Subject: parsedSubject,
      TextBody: parsedBody,
      HtmlBody: `<div style="font-family: sans-serif; line-height: 1.5;">${htmlBody}</div>`
    });
    return {
      provider: "postmark",
      providerMessageId: response?.MessageID || null
    };
  }

  // Fallback provider for local/dev or transitional deployments.
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465", 10),
    secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const info = await transporter.sendMail({
    from,
    to,
    subject: parsedSubject,
    text: parsedBody,
    html: `<div style="font-family: sans-serif; line-height: 1.5;">${htmlBody}</div>`
  });

  return {
    provider: "smtp",
    providerMessageId: info?.messageId || null
  };
}
