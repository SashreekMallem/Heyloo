/**
 * RFC 5322 / MIME message construction for the SMTP email adapter
 * (docs/design/MESSAGING_PROVIDERS.md, docs/SETUP_EMAIL.md). Pure string
 * building, no I/O and no runtime globals, so it runs (and is unit-tested)
 * identically under Deno and Node.
 *
 * What it guarantees, because nothing else sits between us and the owner's
 * mailbox provider:
 * - the output is pure 7-bit ASCII with CRLF line endings and every line
 *   well under the RFC 5322 limit of 998 octets (bodies are
 *   quoted-printable over UTF-8, header text is RFC 2047 encoded when it
 *   is not plain ASCII), so no SMTPUTF8/8BITMIME negotiation is needed;
 * - no caller- or template-controlled string can inject a header or an SMTP
 *   command (CR, LF and other control characters are stripped from every
 *   header value; addresses must be plain ASCII addr-spec);
 * - a deterministic `Message-ID` derived from the send's idempotency key, so
 *   a retry after an ambiguous failure (connection dropped after DATA,
 *   before the 250) carries the SAME id and the receiving system can drop
 *   the duplicate. SMTP has no idempotency key of its own.
 *
 * Rule 1: RFC 5322 (message format), RFC 2045/2047 (MIME, encoded words),
 * RFC 3834 (Auto-Submitted). Listed in docs/VERIFY.md MSG-3.
 */

export interface Mailbox {
  /** Display name, or `null` for a bare address. */
  name: string | null;
  /** ASCII addr-spec, `local@domain`. */
  address: string;
}

const CRLF = "\r\n";

// RFC 5322 addr-spec, restricted to what real mailboxes use: dot-atom local
// part (atext characters) and a hostname-style domain. Quoted local parts,
// IP literals and non-ASCII (SMTPUTF8) addresses are rejected on purpose.
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_PART =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** True for a plain-ASCII addr-spec that is safe to place in an SMTP
 * `MAIL FROM` / `RCPT TO` command and in a header. */
export function isSafeAddress(address: string): boolean {
  if (address.length > 254) return false;
  const at = address.lastIndexOf("@");
  if (at < 1) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  return local.length <= 64 && LOCAL_PART.test(local) && DOMAIN_PART.test(domain);
}

/** Parses `alerts@x.com`, `Name <alerts@x.com>` or `"Name, Inc." <alerts@x.com>`. */
export function parseMailbox(raw: string): Mailbox | null {
  const value = raw.trim();
  const angle = /^(.*?)\s*<([^<>\s]+)>$/s.exec(value);
  if (angle) {
    const address = angle[2] as string;
    if (!isSafeAddress(address)) return null;
    let name: string | null = (angle[1] as string).trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
      name = name.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    name = stripControls(name);
    return { name: name.length > 0 ? name : null, address };
  }
  return isSafeAddress(value) ? { name: null, address: value } : null;
}

function stripControls(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: this IS the control-character filter.
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

function isPrintableAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Base64 of a string's UTF-8 bytes (used for the SMTP AUTH exchange too). */
export function base64OfUtf8(text: string): string {
  return base64(utf8(text));
}

/**
 * RFC 2047 "B" encoded words for arbitrary Unicode header text. Each word
 * is at most 75 characters (the first one is shortened to leave room for the
 * `prefixLength` characters already on its line) and never splits a UTF-8
 * sequence; words are joined with a folding space.
 */
export function encodeWords(text: string, prefixLength = 0): string {
  // 12 = "=?UTF-8?B?" + "?="; base64 turns every 3 bytes into 4 characters.
  const budget = (lineRoom: number) => Math.max(3, Math.floor((lineRoom - 12) / 4) * 3);
  const words: string[] = [];
  let maxBytes = budget(76 - prefixLength);
  let chunk: string[] = [];
  let chunkBytes = 0;
  const flush = () => {
    if (chunk.length > 0) words.push(`=?UTF-8?B?${base64(utf8(chunk.join("")))}?=`);
    chunk = [];
    chunkBytes = 0;
    maxBytes = budget(75); // continuation lines start with one folding space
  };
  for (const char of text) {
    const size = utf8(char).length;
    if (chunkBytes + size > maxBytes) flush();
    chunk.push(char);
    chunkBytes += size;
  }
  flush();
  return words.join(`${CRLF} `);
}

/** Folds an ASCII header value at whitespace so no line exceeds `limit`. */
function foldAscii(prefix: string, value: string, limit = 76): string {
  const tokens = value.split(" ");
  const lines: string[] = [];
  let line = prefix;
  let lineHasToken = false;
  for (const token of tokens) {
    const joiner = lineHasToken ? " " : "";
    if (lineHasToken && line.length + joiner.length + token.length > limit) {
      lines.push(line);
      line = ` ${token}`;
    } else {
      line += `${joiner}${token}`;
    }
    lineHasToken = true;
  }
  lines.push(line);
  return lines.join(CRLF);
}

/**
 * One unstructured header line (Subject, ...), folded and, when the text is
 * not plain ASCII, RFC 2047 encoded. Control characters (including CR/LF, the
 * header-injection vector) are collapsed to spaces first.
 */
export function headerLine(name: string, rawValue: string): string {
  const value = stripControls(rawValue).replace(/ {2,}/g, " ");
  const prefix = `${name}: `;
  if (isPrintableAscii(value)) {
    const folded = foldAscii(prefix, value);
    if (folded.split(CRLF).every((l) => l.length <= 998)) return folded;
  }
  return `${prefix}${encodeWords(value, prefix.length)}`;
}

/** A display name as an RFC 5322 phrase: atom text, quoted-string or encoded words. */
function phrase(name: string): string {
  if (!isPrintableAscii(name)) return encodeWords(name);
  if (/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~ -]+$/.test(name)) return name;
  return `"${name.replace(/(["\\])/g, "\\$1")}"`;
}

/** `Name <addr>` / `<addr>` for a From/To/Reply-To header. */
export function formatMailbox(mailbox: Mailbox): string {
  const name = mailbox.name ? stripControls(mailbox.name) : "";
  return name ? `${phrase(name)} <${mailbox.address}>` : `<${mailbox.address}>`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** RFC 5322 `date-time`, always UTC (`+0000`). */
export function formatRfc5322Date(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${two(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:` +
    `${two(date.getUTCSeconds())} +0000`
  );
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * `<key@domain>`, deterministic in the idempotency key. Characters outside
 * RFC 5322 atext become `-`; when that changed the key, a short hash keeps two
 * different keys from colliding.
 */
export function messageIdFor(idempotencyKey: string, domain: string): string {
  const cleaned = idempotencyKey.replace(/[^A-Za-z0-9!#$%&'*+/=?^_`{|}~-]/g, "-").slice(0, 100);
  const local = cleaned === idempotencyKey ? cleaned : `${cleaned}.${fnv1a(idempotencyKey)}`;
  return `<${local}@${domain}>`;
}

/**
 * RFC 2045 quoted-printable over UTF-8, hard line breaks preserved as CRLF,
 * soft breaks so no line exceeds 76 characters, trailing whitespace encoded.
 */
export function encodeQuotedPrintable(text: string): string {
  const out: string[] = [];
  for (const logical of text.replace(/\r\n|\r/g, "\n").split("\n")) {
    const bytes = utf8(logical);
    let line = "";
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i] as number;
      const isLast = i === bytes.length - 1;
      let token: string;
      if ((b === 0x20 || b === 0x09) && !isLast) token = String.fromCharCode(b);
      else if (b >= 33 && b <= 126 && b !== 61) token = String.fromCharCode(b);
      else token = `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
      if (line.length + token.length > 75) {
        out.push(`${line}=`);
        line = "";
      }
      line += token;
    }
    out.push(line);
  }
  return out.join(CRLF);
}

export interface MimeMessageInput {
  from: Mailbox;
  to: Mailbox;
  replyTo?: Mailbox;
  subject: string;
  text: string;
  html: string;
  /** Full `<local@domain>` form, see `messageIdFor`. */
  messageId: string;
  date: Date;
  /** MIME boundary (unique per message; 8-70 chars from the bchars set). */
  boundary: string;
}

function textPart(contentType: string, body: string): string {
  return (
    `Content-Type: ${contentType}; charset=utf-8${CRLF}` +
    `Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}` +
    encodeQuotedPrintable(body)
  );
}

/**
 * The full RFC 5322 message, CRLF line endings, ASCII only: headers, a blank
 * line, then `multipart/alternative` (plain text first, HTML second, the
 * order MIME clients expect) or a single `text/plain` part when there is no
 * HTML. Throws when both bodies are empty (nothing to send).
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  const hasText = input.text.trim().length > 0;
  const hasHtml = input.html.trim().length > 0;
  if (!hasText && !hasHtml) throw new Error("empty_message_body");

  const headers = [
    `Date: ${formatRfc5322Date(input.date)}`,
    `From: ${formatMailbox(input.from)}`,
    `To: ${formatMailbox(input.to)}`,
    ...(input.replyTo ? [`Reply-To: ${formatMailbox(input.replyTo)}`] : []),
    headerLine("Subject", input.subject),
    `Message-ID: ${input.messageId}`,
    "MIME-Version: 1.0",
    // RFC 3834: tells autoresponders (vacation replies, ticket systems) not
    // to answer an automated notification.
    "Auto-Submitted: auto-generated",
  ];

  let body: string;
  if (hasText && hasHtml) {
    headers.push(`Content-Type: multipart/alternative; boundary="${input.boundary}"`);
    body =
      `--${input.boundary}${CRLF}${textPart("text/plain", input.text)}${CRLF}` +
      `--${input.boundary}${CRLF}${textPart("text/html", input.html)}${CRLF}` +
      `--${input.boundary}--${CRLF}`;
  } else {
    const single = hasText ? textPart("text/plain", input.text) : textPart("text/html", input.html);
    const split = single.indexOf(`${CRLF}${CRLF}`);
    headers.push(single.slice(0, split));
    body = `${single.slice(split + 4)}${CRLF}`;
  }

  return `${headers.join(CRLF)}${CRLF}${CRLF}${body}`;
}
