import { describe, expect, it } from "vitest";
import { buildReplyRaw, htmlToText, parseAddress, parseGmailMessage, stripQuotedReply, type GmailMessage } from "./gmail-parse";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

const fixture: GmailMessage = {
  id: "18f1a2b3c4d5e6f7",
  threadId: "18f1a2b3c4d5e000",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Bonjour, ma commande #1002 n'est toujours pas arrivée",
  internalDate: "1790424000000",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Jane Doe <Jane.Doe@Example.com>" },
      { name: "To", value: "support@maisonlune.fr" },
      { name: "Subject", value: "Commande #1002" },
      { name: "Message-ID", value: "<abc123@mail.example.com>" },
      { name: "Date", value: "Fri, 26 Sep 2026 12:00:00 +0000" },
    ],
    parts: [
      {
        mimeType: "text/plain",
        body: { data: b64("Bonjour,\r\nma commande #1002 n'est toujours pas arrivée.\r\nMerci\r\n\r\nLe 20 sept. 2026, support a écrit :\r\n> Bonjour Jane, votre colis part demain.") },
      },
      { mimeType: "text/html", body: { data: b64("<p>Bonjour,<br>ma commande #1002…</p>") } },
    ],
  },
};

describe("parseGmailMessage", () => {
  it("extracts headers, hashes the sender, strips the quoted reply and keeps the name", () => {
    const parsed = parseGmailMessage(fixture, "support@maisonlune.fr");
    expect(parsed.providerMessageId).toBe("18f1a2b3c4d5e6f7");
    expect(parsed.providerThreadId).toBe("18f1a2b3c4d5e000");
    expect(parsed.direction).toBe("in");
    expect(parsed.subject).toBe("Commande #1002");
    expect(parsed.fromName).toBe("Jane Doe");
    expect(parsed.fromEmail).toBe("jane.doe@example.com");
    expect(parsed.fromEmailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.replyTo).toBe("jane.doe@example.com");
    expect(parsed.rfcMessageId).toBe("<abc123@mail.example.com>");
    expect(parsed.receivedAt).toBe("2026-09-26T12:00:00.000Z");
    expect(parsed.bodyText).toBe("Bonjour,\nma commande #1002 n'est toujours pas arrivée.\nMerci");
    expect(parsed.snippet).toContain("#1002");
  });
  it("marks mails sent by the mailbox as outbound and falls back to HTML", () => {
    const sent: GmailMessage = {
      ...fixture,
      id: "x",
      labelIds: ["SENT"],
      payload: {
        mimeType: "text/html",
        headers: [{ name: "From", value: "support@maisonlune.fr" }, { name: "Subject", value: "Re: Commande #1002" }],
        body: { data: b64("<div>Bonjour Jane,</div><div>votre colis &amp; suivi : <a href='x'>ici</a></div>") },
      },
    };
    const parsed = parseGmailMessage(sent, "support@maisonlune.fr");
    expect(parsed.direction).toBe("out");
    expect(parsed.bodyText).toBe("Bonjour Jane,\nvotre colis & suivi : ici");
  });
});

describe("helpers", () => {
  it("parses addresses", () => {
    expect(parseAddress('"Doe, Jane" <j@x.com>')).toEqual({ name: "Doe, Jane", email: "j@x.com" });
    expect(parseAddress("j@x.com")).toEqual({ name: null, email: "j@x.com" });
  });
  it("strips quoted replies in English too", () => {
    expect(stripQuotedReply("Thanks!\n\nOn Mon, Sep 1 2026, Shop wrote:\n> hello")).toBe("Thanks!");
  });
  it("converts html to text", () => {
    expect(htmlToText("<style>p{}</style><p>Hi</p><p>There&nbsp;!</p>")).toBe("Hi\nThere !");
  });
  it("builds a threaded RFC 2822 reply", () => {
    const raw = Buffer.from(
      buildReplyRaw({
        from: "support@maisonlune.fr",
        to: "jane.doe@example.com",
        subject: "Commande #1002",
        body: "Bonjour Jane,\n\nL'équipe Maison Lune",
        inReplyTo: "<abc123@mail.example.com>",
        references: "<first@mail.example.com>",
      }),
      "base64url",
    ).toString("utf8");
    expect(raw).toContain("To: jane.doe@example.com");
    expect(raw).toContain("In-Reply-To: <abc123@mail.example.com>");
    expect(raw).toContain("References: <first@mail.example.com> <abc123@mail.example.com>");
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
  });
});
