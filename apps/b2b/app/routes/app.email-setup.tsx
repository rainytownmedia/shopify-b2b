import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import React from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templates = await db.emailTemplate.findMany({
    where: {
      shopId: session.shop,
      type: { in: ["CUSTOMER_APPROVED", "CUSTOMER_PENDING", "ADMIN_NEW_APP"] }
    }
  });

  const approvedTemplate = templates.find((t) => t.type === "CUSTOMER_APPROVED");
  const pendingTemplate = templates.find((t) => t.type === "CUSTOMER_PENDING");
  const ownerTemplate = templates.find((t) => t.type === "ADMIN_NEW_APP");

  return { approvedTemplate, pendingTemplate, ownerTemplate };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const emailApprovedSubject = formData.get("emailApprovedSubject") as string;
  const emailApprovedBody = formData.get("emailApprovedBody") as string;
  const emailPendingSubject = formData.get("emailPendingSubject") as string;
  const emailPendingBody = formData.get("emailPendingBody") as string;
  const emailOwnerSubject = formData.get("emailOwnerSubject") as string;
  const emailOwnerBody = formData.get("emailOwnerBody") as string;

  await db.emailTemplate.upsert({
    where: { shopId_type: { shopId: session.shop, type: "CUSTOMER_APPROVED" } },
    update: { subject: emailApprovedSubject, body: emailApprovedBody, isActive: true },
    create: {
      shopId: session.shop,
      type: "CUSTOMER_APPROVED",
      isActive: true,
      subject: emailApprovedSubject,
      body: emailApprovedBody
    }
  });

  await db.emailTemplate.upsert({
    where: { shopId_type: { shopId: session.shop, type: "CUSTOMER_PENDING" } },
    update: { subject: emailPendingSubject, body: emailPendingBody, isActive: true },
    create: {
      shopId: session.shop,
      type: "CUSTOMER_PENDING",
      isActive: true,
      subject: emailPendingSubject,
      body: emailPendingBody
    }
  });

  await db.emailTemplate.upsert({
    where: { shopId_type: { shopId: session.shop, type: "ADMIN_NEW_APP" } },
    update: { subject: emailOwnerSubject, body: emailOwnerBody, isActive: true },
    create: {
      shopId: session.shop,
      type: "ADMIN_NEW_APP",
      isActive: true,
      subject: emailOwnerSubject,
      body: emailOwnerBody
    }
  });

  return { success: true };
};

export default function EmailSetupPage() {
  const { approvedTemplate, pendingTemplate, ownerTemplate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [approvedSubject, setApprovedSubject] = useState(approvedTemplate?.subject || "Your account is approved");
  const [approvedBody, setApprovedBody] = useState(approvedTemplate?.body || "Hi [customerFirstName] [customerLastName], your account is approved.");
  const [pendingSubject, setPendingSubject] = useState(pendingTemplate?.subject || "Your account is under review");
  const [pendingBody, setPendingBody] = useState(pendingTemplate?.body || "Hi [customerFirstName] [customerLastName], your registration is under review.");
  const [ownerSubject, setOwnerSubject] = useState(ownerTemplate?.subject || "A potential customer signed up");
  const [ownerBody, setOwnerBody] = useState(ownerTemplate?.body || "A potential customer has submitted their details through the registration form.");

  const handleSave = () => {
    fetcher.submit({
      emailApprovedSubject: approvedSubject,
      emailApprovedBody: approvedBody,
      emailPendingSubject: pendingSubject,
      emailPendingBody: pendingBody,
      emailOwnerSubject: ownerSubject,
      emailOwnerBody: ownerBody
    }, { method: "POST" });
    shopify.toast.show("Email settings saved");
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "B2B Customers", url: "/app/customer-management" }, { label: "Email Setup" }]} />
      <s-page heading="Notification Settings" back-action-url="/app/customer-management">
        <div style={{ maxWidth: "1040px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "32px" }}>
          <NotificationSection
            title="Send Customer's Approval Notification"
            subject={approvedSubject}
            body={approvedBody}
            onSubjectChange={setApprovedSubject}
            onBodyChange={setApprovedBody}
          />

          <NotificationSection
            title="Send Customer's Request Submitted Notification"
            subject={pendingSubject}
            body={pendingBody}
            onSubjectChange={setPendingSubject}
            onBodyChange={setPendingBody}
          />

          <NotificationSection
            title="Send Owner's Request Received Notification"
            subject={ownerSubject}
            body={ownerBody}
            onSubjectChange={setOwnerSubject}
            onBodyChange={setOwnerBody}
          />

          <div style={{ textAlign: "right" }}>
            <s-button variant="primary" onClick={handleSave}>Save notification settings</s-button>
          </div>
        </div>
      </s-page>
    </>
  );
}

function NotificationSection({
  title,
  subject,
  body,
  onSubjectChange,
  onBodyChange
}: {
  title: string;
  subject: string;
  body: string;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={sectionHeadingStyle}>
        <input type="checkbox" checked readOnly />
        <strong>{title}</strong>
      </div>
      <div style={sectionGridStyle}>
        <div>
          <label style={labelStyle}>Email Subject</label>
          <input type="text" value={subject} onChange={(e) => onSubjectChange(e.target.value)} style={inputStyle} />
          <label style={{ ...labelStyle, marginTop: "12px" }}>Email Body</label>
          <RichTextEditor value={body} onChange={onBodyChange} />
        </div>
        <div style={shortcodesStyle}>
          <strong>Shortcodes</strong>
          <ul style={shortcodesListStyle}>
            <li>[customerFirstName]</li>
            <li>[customerLastName]</li>
            <li>[customerEmail]</li>
            <li>[customerStatus]</li>
            <li>[customerAddress]</li>
            <li>[customerCity]</li>
            <li>[customerProvince]</li>
            <li>[customerCountry]</li>
            <li>[customerZipCode]</li>
            <li>[customerCompany]</li>
            <li>[customerPhone]</li>
            <li>[customerNote]</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = (command: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command);
    onChange(editorRef.current.innerHTML);
  };

  const changeFontSize = (delta: number) => {
    if (!editorRef.current) return;
    const base = 14;
    const current = parseInt(editorRef.current.dataset.fontSize || `${base}`, 10);
    const next = Math.min(28, Math.max(10, current + delta));
    editorRef.current.dataset.fontSize = `${next}`;
    editorRef.current.style.fontSize = `${next}px`;
    editorRef.current.focus();
    onChange(editorRef.current.innerHTML);
  };

  const addLink = () => {
    if (!editorRef.current) return;
    const url = window.prompt("Enter URL");
    if (!url) return;
    editorRef.current.focus();
    document.execCommand("createLink", false, url);
    onChange(editorRef.current.innerHTML);
  };

  return (
    <div style={editorWrapperStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={toolbarButtonStyle} onClick={() => changeFontSize(-1)}>A-</button>
        <button type="button" style={toolbarButtonStyle} onClick={() => changeFontSize(1)}>A+</button>
        <button type="button" style={toolbarButtonStyle} onClick={() => exec("bold")}><strong>B</strong></button>
        <button type="button" style={toolbarButtonStyle} onClick={() => exec("italic")}><em>I</em></button>
        <button type="button" style={toolbarButtonStyle} onClick={() => exec("underline")}><u>U</u></button>
        <button type="button" style={toolbarButtonStyle} onClick={addLink}>🔗</button>
        <button type="button" style={toolbarIconButtonStyle} title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M4 4.5h1v4H4v-3l-.8.5-.4-.7L4 4.5zm0 7h1.8v.8H3.5v-.7c0-.5.2-.9.8-1.3.5-.3.7-.5.7-.8 0-.2-.2-.4-.5-.4-.3 0-.6.1-.9.3l-.3-.7c.3-.2.7-.4 1.3-.4.9 0 1.4.4 1.4 1.1 0 .5-.3.9-.9 1.3-.4.3-.6.4-.7.6z" fill="currentColor"/>
            <path d="M8 5h9v1H8zm0 4h9v1H8zm0 4h9v1H8z" fill="currentColor"/>
          </svg>
        </button>
        <button type="button" style={toolbarIconButtonStyle} title="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="4" cy="5.5" r="1.1" fill="currentColor" />
            <circle cx="4" cy="10" r="1.1" fill="currentColor" />
            <circle cx="4" cy="14.5" r="1.1" fill="currentColor" />
            <path d="M7 5h10v1H7zm0 4.5h10v1H7zm0 4.5h10v1H7z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        style={editorContentStyle}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}

const cardStyle = { background: "white", padding: "16px", borderRadius: "8px", border: "1px solid #d8d8d8" };
const labelStyle = { display: "block", marginBottom: "6px", fontWeight: 600 as const, fontSize: "13px" };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #c9c9c9", boxSizing: "border-box" as const };
const sectionHeadingStyle = { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", fontSize: "13px" };
const sectionGridStyle = { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" };
const shortcodesStyle = { border: "1px solid #e5e5e5", borderRadius: "8px", padding: "10px", fontSize: "12px" };
const shortcodesListStyle = { margin: "8px 0 0 18px", padding: 0, lineHeight: 1.6 };
const editorWrapperStyle = { border: "1px solid #c9c9c9", borderRadius: "6px", overflow: "hidden" };
const toolbarStyle = { display: "flex", gap: "6px", flexWrap: "wrap" as const, padding: "8px", borderBottom: "1px solid #e5e5e5", background: "#f9f9f9" };
const toolbarButtonStyle = { border: "1px solid #d0d0d0", background: "white", borderRadius: "4px", padding: "2px 8px", cursor: "pointer" };
const toolbarIconButtonStyle = { border: "1px solid #d0d0d0", background: "white", borderRadius: "4px", width: "30px", height: "24px", cursor: "pointer", fontWeight: 600 as const };
const editorContentStyle = { minHeight: "150px", padding: "10px", outline: "none" };
