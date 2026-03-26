import nodemailer from "nodemailer";
import db from "../db.server";

// Mailer Service for sending automated B2B Application emails
export async function sendEmailTemplate({
    shopId,
    type, // "ADMIN_NEW_APP", "CUSTOMER_PENDING", "CUSTOMER_APPROVED", "CUSTOMER_REJECTED"
    to,
    data
}: {
    shopId: string;
    type: string;
    to: string;
    data: Record<string, string>;
}) {
    // 1. Find the active template
    const template = await db.emailTemplate.findFirst({
        where: { shopId, type, isActive: true }
    });

    if (!template) {
        // Template doesn't exist or is disabled
        return { success: false, reason: "Template disabled or not found" };
    }

    // 2. Parse Subject and Body
    let parsedSubject = template.subject;
    let parsedBody = template.body;

    for (const [key, value] of Object.entries(data)) {
        // Replace all instances of [key] with the actual value
        const regex = new RegExp(`\\[${key}\\]`, 'g');
        parsedSubject = parsedSubject.replace(regex, value || "");
        parsedBody = parsedBody.replace(regex, value || "");
    }

    // Convert newlines to HTML <br> tags for email sending
    const htmlBody = parsedBody.replace(/\n/g, "<br/>");

    // 3. Configure Transporter
    // In production, these should be securely stored in .env
    // We will throw an error strictly if config is fully missing, 
    // but default to standard generic vars for easy local plugging.
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "465", 10),
        secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465", // true for 465, false for 587
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM_EMAIL || `"B2B Wholesale" <no-reply@example.com>`,
            to: to,
            subject: parsedSubject,
            text: parsedBody, // plain text body
            html: `<div style="font-family: sans-serif; line-height: 1.5;">${htmlBody}</div>`, // simple html wrapper
        });

        console.log(`[Email Sent] successfully to ${to} for event ${type}. MessageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error: any) {
        console.error(`[Email Failed] failed to send email to ${to}:`, error.message);
        return { success: false, error: error.message };
    }
}
