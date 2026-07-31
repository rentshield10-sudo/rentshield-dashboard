import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

// Replicates the reference lease document's exact visual structure (bold
// numbered section headers, centered underlined title, justified body
// paragraphs, bulleted lists, a proper signature block) instead of the
// earlier bare word-wrapped text dump -- built with @react-pdf/renderer,
// which gives real typographic control (bold/justify/center/underline)
// that pdf-lib's raw drawText API doesn't.

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontSize: 11,
    fontFamily: "Helvetica",
    lineHeight: 1.4,
    color: "#111111",
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    textAlign: "center",
    textDecoration: "underline",
    marginBottom: 14,
  },
  paragraph: {
    textAlign: "justify",
    marginBottom: 10,
  },
  bold: {
    fontFamily: "Helvetica-Bold",
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  bulletMark: {
    width: 14,
  },
  bulletText: {
    flex: 1,
    textAlign: "justify",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    borderBottom: "1pt solid #111111",
  },
  dividerLabel: {
    marginHorizontal: 10,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  sigHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 16,
  },
  sigRoleHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginTop: 14,
    marginBottom: 6,
  },
  sigLine: {
    flexDirection: "row",
    marginBottom: 14,
  },
  sigLineLabel: {
    marginRight: 4,
  },
  sigLineBlank: {
    borderBottom: "1pt solid #111111",
    minWidth: 130,
    marginRight: 14,
  },
});

// Requires the colon (non-greedy up to it) -- an earlier version made the
// colon optional, which let the non-greedy match stop at the first word
// followed by any whitespace (e.g. "1. GRANT" instead of "1. GRANT OF
// LEASE:"), since nothing forced it to keep scanning for the real colon.
const SECTION_HEADER_PATTERN = /^(\d{1,2})\.\s+([A-Z][A-Za-z0-9\s/'".,&()-]*?):/;
// A numbered section with no colon at all (e.g. "40. GUEST POLICY") -- the
// whole line is bolded instead of just a "N. TITLE:" prefix.
const SECTION_HEADER_NO_COLON_PATTERN = /^(\d{1,2})\.\s+[A-Z][A-Z\s]+$/;
// Short standalone lines ending in a colon read as sub-headers within a
// section (e.g. "Notice of Extended Guests:") rather than as running text.
const SUBHEADING_PATTERN = /^[A-Z][A-Za-z\s]{2,40}:$/;
const BULLET_PATTERN = /^[••]\s*/;
const LETTERED_PATTERN = /^\(([a-z])\)\s*/;
const END_OF_CONTRACT_PATTERN = /^-+\s*END OF CONTRACT\s*-+$/i;

function splitBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function renderInlineBoldPrefix(line: string, key: string): ReactElement {
  const match = line.match(SECTION_HEADER_PATTERN);
  if (!match) {
    return (
      <Text key={key} style={styles.paragraph}>
        {line}
      </Text>
    );
  }
  const prefixEnd = match[0].trimEnd().length;
  const boldPart = line.slice(0, prefixEnd);
  const restPart = line.slice(prefixEnd);
  return (
    <Text key={key} style={styles.paragraph}>
      <Text style={styles.bold}>{boldPart}</Text>
      {restPart}
    </Text>
  );
}

function renderBlock(block: string, index: number): ReactElement {
  const lines = block.split("\n").map((l) => l.trim());

  if (lines.every((l) => BULLET_PATTERN.test(l))) {
    return (
      <View key={index} style={{ marginBottom: 10 }}>
        {lines.map((l, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={styles.bulletMark}>•</Text>
            <Text style={styles.bulletText}>{l.replace(BULLET_PATTERN, "")}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (lines.every((l) => LETTERED_PATTERN.test(l))) {
    return (
      <View key={index} style={{ marginBottom: 10 }}>
        {lines.map((l, i) => (
          <Text key={i} style={styles.paragraph}>
            {l}
          </Text>
        ))}
      </View>
    );
  }

  // Mixed block: first line may be a numbered section header (bolded
  // inline), later standalone short lines may be sub-headers (bolded
  // whole-line), everything else is regular justified text.
  return (
    <View key={index} style={{ marginBottom: 0 }}>
      {lines.map((line, i) => {
        const lineKey = `${index}-${i}`;
        if (i === 0 && SECTION_HEADER_NO_COLON_PATTERN.test(line)) {
          return (
            <Text key={lineKey} style={[styles.paragraph, styles.bold]}>
              {line}
            </Text>
          );
        }
        if (i === 0 && SECTION_HEADER_PATTERN.test(line)) {
          return renderInlineBoldPrefix(line, lineKey);
        }
        if (SUBHEADING_PATTERN.test(line)) {
          return (
            <Text key={lineKey} style={[styles.paragraph, styles.bold]}>
              {line}
            </Text>
          );
        }
        return (
          <Text key={lineKey} style={styles.paragraph}>
            {line}
          </Text>
        );
      })}
    </View>
  );
}

export interface SignatureBlockParticipant {
  role: string;
  name: string;
}

function SignatureBlock({ participants }: { participants: SignatureBlockParticipant[] }) {
  const landlord = participants.filter((p) => p.role === "Landlord");
  const tenants = participants.filter((p) => p.role === "Tenant");
  const witnesses = participants.filter((p) => p.role !== "Landlord" && p.role !== "Tenant");

  function sigLine(name: string, key: string) {
    return (
      <View key={key} style={styles.sigLine}>
        <Text style={styles.sigLineLabel}>Sign:</Text>
        <View style={styles.sigLineBlank} />
        <Text style={styles.sigLineLabel}>Print: {name || "___________"}</Text>
        <Text style={styles.sigLineLabel}> Date:</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>END OF CONTRACT</Text>
        <View style={styles.dividerLine} />
      </View>
      <Text style={styles.sigHeading}>
        WITNESS THE SIGNATURES OF THE PARTIES TO THIS RESIDENTIAL LEASE AGREEMENT
      </Text>

      <Text style={styles.sigRoleHeading}>LANDLORD</Text>
      {landlord.length > 0
        ? landlord.map((p, i) => sigLine(p.name, `landlord-${i}`))
        : sigLine("", "landlord-0")}

      <Text style={styles.sigRoleHeading}>TENANT</Text>
      {tenants.length > 0 ? tenants.map((p, i) => sigLine(p.name, `tenant-${i}`)) : sigLine("", "tenant-0")}

      {witnesses.map((p, i) => (
        <View key={`witness-${i}`}>
          <Text style={styles.sigRoleHeading}>{p.role.toUpperCase()}</Text>
          {sigLine(p.name, `witness-line-${i}`)}
        </View>
      ))}
    </View>
  );
}

function LeaseDocument({
  text,
  participants,
}: {
  text: string;
  participants: SignatureBlockParticipant[];
}) {
  const blocks = splitBlocks(text);
  const title = blocks[0] ?? "";
  // SignatureBlock always renders its own "END OF CONTRACT" divider, so
  // drop one if the template body already ends with one (it currently
  // does, but this stays correct even if that changes).
  const body = blocks.slice(1).filter((b) => !END_OF_CONTRACT_PATTERN.test(b));

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <Text style={styles.title}>{title}</Text>
        {body.map((block, i) => renderBlock(block, i))}
        <SignatureBlock participants={participants} />
      </Page>
    </Document>
  );
}

export async function renderLeaseLayoutPdf(
  text: string,
  participants: SignatureBlockParticipant[],
): Promise<Buffer> {
  return renderToBuffer(<LeaseDocument text={text} participants={participants} />);
}
