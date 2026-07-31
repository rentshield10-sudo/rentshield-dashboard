import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { SignatureBlock, type SignatureBlockParticipant } from "@/lib/pdf-signature-block";

// Replicates pages 1-2 (the disclosure form itself) of the reference
// "LEAD-BASED PAINT DISCLOSURE" document -- the boilerplate disclosure text
// and checkbox selections are fixed/federal-form content, identical on
// every lease, so only the signature block below is participant-driven
// (same SignatureBlockParticipant list as the main lease). Pages 3-4 of the
// reference (a PandaDoc completion certificate) are intentionally not
// reproduced -- not part of the actual disclosure.

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
    marginBottom: 14,
  },
  paragraph: {
    textAlign: "justify",
    marginBottom: 10,
  },
  bold: {
    fontFamily: "Helvetica-Bold",
  },
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginTop: 14,
    marginBottom: 6,
  },
  subHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginTop: 10,
    marginBottom: 4,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  checkbox: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: "#111111",
    marginRight: 6,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxMark: {
    width: 6,
    height: 6,
    backgroundColor: "#111111",
  },
  checkboxText: {
    flex: 1,
    textAlign: "justify",
  },
  blankLine: {
    borderBottom: "1pt solid #111111",
    marginBottom: 10,
    height: 12,
  },
});

function Checkbox({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <View style={styles.checkboxRow}>
      <View style={styles.checkbox}>{checked && <View style={styles.checkboxMark} />}</View>
      <Text style={styles.checkboxText}>{children}</Text>
    </View>
  );
}

function LeadPaintDisclosureDocument({ participants }: { participants: SignatureBlockParticipant[] }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <Text style={styles.title}>LEAD-BASED PAINT DISCLOSURE</Text>
        <Text style={styles.paragraph}>(Required for Rental Properties Built Before 1978)</Text>
        <Text style={styles.paragraph}>
          This disclosure is made in accordance with the{" "}
          <Text style={styles.bold}>Residential Lead-Based Paint Hazard Reduction Act of 1992</Text> (42 U.S.C.
          4852d).
        </Text>

        <Text style={styles.sectionHeading}>1. NOTICE TO TENANT</Text>
        <Text style={styles.paragraph}>
          Housing built before 1978 may contain lead-based paint. Lead from paint, paint chips, and dust can pose
          health hazards if not managed properly. Lead exposure is especially harmful to young children and
          pregnant women. Before renting pre-1978 housing, landlords must disclose the presence of known
          lead-based paint and lead-based paint hazards. Renters should also receive a federally approved
          pamphlet on lead poisoning prevention.
        </Text>

        <Text style={styles.sectionHeading}>2. DISCLOSURE OF INFORMATION</Text>
        <Text style={styles.subHeading}>(a) Landlord&apos;s Disclosure</Text>
        <Checkbox checked>
          The rental property <Text style={styles.bold}>was constructed before 1978</Text>.
        </Checkbox>
        <Checkbox checked={false}>
          The rental property <Text style={styles.bold}>was constructed in 1978 or later</Text> (no further
          disclosure is required).
        </Checkbox>

        <Text style={styles.subHeading}>(b) Presence of Lead-Based Paint or Lead Hazards</Text>
        <Checkbox checked>
          Landlord has <Text style={styles.bold}>no knowledge</Text> of lead-based paint or lead-based paint
          hazards in the property.
        </Checkbox>
        <Checkbox checked={false}>
          Landlord <Text style={styles.bold}>is aware</Text> of the presence of lead-based paint or lead-based
          paint hazards in the property, as described below:
        </Checkbox>
        <View style={styles.blankLine} />
        <View style={styles.blankLine} />

        <Text style={styles.subHeading}>(c) Records and Reports</Text>
        <Checkbox checked>
          Landlord <Text style={styles.bold}>has no reports or records</Text> pertaining to lead-based paint or
          lead-based paint hazards in the property.
        </Checkbox>
        <Checkbox checked={false}>
          Landlord <Text style={styles.bold}>has provided</Text> the tenant with all available records and
          reports regarding lead-based paint or lead-based paint hazards, as listed below:
        </Checkbox>
        <View style={styles.blankLine} />
        <View style={styles.blankLine} />

        <Text style={styles.sectionHeading}>3. TENANT ACKNOWLEDGMENT</Text>
        <Checkbox checked>
          Tenant has received a copy of the EPA-approved pamphlet{" "}
          <Text style={styles.bold}>&quot;Protect Your Family from Lead in Your Home.&quot;</Text>
        </Checkbox>
        <Checkbox checked>
          Tenant has received copies of any available lead-based paint reports (if applicable)
        </Checkbox>

        <Text style={styles.sectionHeading}>4. AGENT ACKNOWLEDGMENT (if applicable)</Text>
        <Checkbox checked>
          Agent has informed the landlord of the landlord&apos;s obligations under{" "}
          <Text style={styles.bold}>42 U.S.C. 4852d</Text> and is aware of their responsibility to ensure
          compliance.
        </Checkbox>

        <Text style={styles.sectionHeading}>5. SIGNATURES</Text>
        <Text style={styles.paragraph}>
          By signing below, the parties acknowledge that they have reviewed and understood the information
          provided in this disclosure.
        </Text>

        <SignatureBlock participants={participants} />
      </Page>
    </Document>
  );
}

export async function renderLeadPaintDisclosurePdf(participants: SignatureBlockParticipant[]): Promise<Buffer> {
  return renderToBuffer(<LeadPaintDisclosureDocument participants={participants} />);
}
