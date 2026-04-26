import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseGmailRetryAfterSeconds,
  parseGmailMessage,
  parseAttachments,
  threadToText,
  type GmailApiMessage,
  type GmailPayloadPart,
} from "../gmail-client";

const TEST_INTERNAL_DATE = String(new Date("2026-04-01T12:00:00.000Z").getTime());

describe("parseGmailRetryAfterSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T00:50:59.763Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses Gmail retry timestamps from error detail", () => {
    expect(
      parseGmailRetryAfterSeconds({
        detail:
          "User-rate limit exceeded. Retry after 2026-04-26T00:51:59.763Z",
      }),
    ).toBe(60);
  });

  it("parses numeric Retry-After headers", () => {
    expect(parseGmailRetryAfterSeconds({ header: "120" })).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// parseGmailMessage
// ---------------------------------------------------------------------------

describe("parseGmailMessage", () => {
  it("parses a simple plain-text message", () => {
    const msg: GmailApiMessage = {
      id: "msg1",
      threadId: "thread1",
      snippet: "Hello world",
      labelIds: ["INBOX", "UNREAD"],
      internalDate: TEST_INTERNAL_DATE,
      sizeEstimate: 1234,
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "To", value: "bob@example.com" },
          { name: "Subject", value: "Test Subject" },
          { name: "Date", value: "Thu, 10 Apr 2026 12:00:00 +0000" },
          { name: "Message-ID", value: "<abc123@example.com>" },
        ],
        body: {
          data: Buffer.from("Hello, this is the body.").toString("base64url"),
        },
      },
    };

    const parsed = parseGmailMessage(msg);

    expect(parsed.gmailMessageId).toBe("msg1");
    expect(parsed.gmailThreadId).toBe("thread1");
    expect(parsed.fromName).toBe("Alice");
    expect(parsed.fromEmail).toBe("alice@example.com");
    expect(parsed.toHeader).toBe("bob@example.com");
    expect(parsed.subject).toBe("Test Subject");
    expect(parsed.bodyText).toBe("Hello, this is the body.");
    expect(parsed.labels).toEqual(["INBOX", "UNREAD"]);
    expect(parsed.messageIdHeader).toBe("<abc123@example.com>");
    expect(parsed.rawSizeEstimate).toBe(1234);
    expect(parsed.isDraft).toBe(false);
  });

  it("parses a multipart/alternative message with HTML + text", () => {
    const msg: GmailApiMessage = {
      id: "msg2",
      threadId: "thread1",
      snippet: "Multi",
      labelIds: [],
      internalDate: TEST_INTERNAL_DATE,
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "bob@test.com" },
          { name: "Subject", value: "Multi" },
          { name: "Date", value: "2026-01-01" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: { data: Buffer.from("Plain version").toString("base64url") },
          },
          {
            mimeType: "text/html",
            body: {
              data: Buffer.from("<b>HTML version</b>").toString("base64url"),
            },
          },
        ],
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.bodyHtml).toBe("<b>HTML version</b>");
    expect(parsed.bodyText).toBe("Plain version");
  });

  it("generates text from HTML when no plain text part exists", () => {
    const msg: GmailApiMessage = {
      id: "msg3",
      threadId: "thread1",
      snippet: "",
      internalDate: TEST_INTERNAL_DATE,
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "From", value: "test@test.com" },
          { name: "Date", value: "2026-01-01" },
        ],
        body: {
          data: Buffer.from("<p>Hello</p><p>World</p>").toString("base64url"),
        },
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.bodyHtml).toBe("<p>Hello</p><p>World</p>");
    expect(parsed.bodyText).toContain("Hello");
    expect(parsed.bodyText).toContain("World");
  });

  it("parses From header without angle brackets", () => {
    const msg: GmailApiMessage = {
      id: "msg4",
      threadId: "thread1",
      snippet: "",
      internalDate: TEST_INTERNAL_DATE,
      payload: {
        headers: [
          { name: "From", value: "plain@email.com" },
          { name: "Date", value: "2026-01-01" },
        ],
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.fromEmail).toBe("plain@email.com");
  });

  it("defaults subject to (no subject) when missing", () => {
    const msg: GmailApiMessage = {
      id: "msg5",
      threadId: "thread1",
      snippet: "",
      internalDate: TEST_INTERNAL_DATE,
      payload: {
        headers: [
          { name: "From", value: "x@x.com" },
          { name: "Date", value: "2026-01-01" },
        ],
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.subject).toBe("(no subject)");
  });

  it("identifies drafts from DRAFT label", () => {
    const msg: GmailApiMessage = {
      id: "msg6",
      threadId: "thread1",
      snippet: "",
      labelIds: ["DRAFT"],
      internalDate: TEST_INTERNAL_DATE,
      payload: {
        headers: [
          { name: "From", value: "x@x.com" },
          { name: "Date", value: "2026-01-01" },
        ],
      },
    };

    const parsed = parseGmailMessage(msg);
    expect(parsed.isDraft).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseAttachments
// ---------------------------------------------------------------------------

describe("parseAttachments", () => {
  it("extracts attachments from nested multipart", () => {
    const msg: GmailApiMessage = {
      id: "msg1",
      threadId: "t1",
      snippet: "",
      payload: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: "dGVzdA" },
          },
          {
            mimeType: "application/pdf",
            filename: "report.pdf",
            body: { attachmentId: "att123", size: 50000 },
          },
          {
            mimeType: "image/png",
            filename: "photo.png",
            body: { attachmentId: "att456", size: 12000 },
          },
        ],
      },
    };

    const atts = parseAttachments(msg);
    expect(atts).toHaveLength(2);
    expect(atts[0]!.filename).toBe("report.pdf");
    expect(atts[0]!.gmailAttachmentId).toBe("att123");
    expect(atts[0]!.size).toBe(50000);
    expect(atts[1]!.filename).toBe("photo.png");
  });

  it("returns empty array for no attachments", () => {
    const msg: GmailApiMessage = {
      id: "msg2",
      threadId: "t1",
      snippet: "",
      payload: {
        mimeType: "text/plain",
        body: { data: "dGVzdA" },
      },
    };

    expect(parseAttachments(msg)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// threadToText
// ---------------------------------------------------------------------------

describe("threadToText", () => {
  it("formats a thread for LLM consumption", () => {
    const messages = [
      {
        gmailMessageId: "m1",
        gmailThreadId: "t1",
        fromName: "Alice",
        fromEmail: "alice@example.com",
        toHeader: "bob@example.com",
        ccHeader: "",
        subject: "Project Update",
        date: "2026-04-01",
        bodyHtml: null,
        bodyText: "Here is the update.",
        snippet: "",
        labels: [],
        messageIdHeader: null,
        inReplyTo: null,
        referencesHeader: null,
        isDraft: false,
        historyId: null,
        rawSizeEstimate: null,
      },
    ];

    const text = threadToText("Project Update", messages);
    expect(text).toContain("Subject: Project Update");
    expect(text).toContain("Alice <alice@example.com>");
    expect(text).toContain("Here is the update.");
  });
});
