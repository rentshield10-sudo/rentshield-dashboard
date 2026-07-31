import { View, Text, StyleSheet } from "@react-pdf/renderer";

// Shared by lib/lease-pdf-layout.tsx and lib/lead-paint-disclosure-layout.tsx --
// both documents end with the exact same "WITNESS THE SIGNATURES..." block
// (Landlord / Tenant x N / other roles, one blank Sign/Print/Date line each),
// driven by the same participant list so both documents stay in sync.

export interface SignatureBlockParticipant {
  role: string;
  name: string;
}

export const signatureStyles = StyleSheet.create({
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

const SIGNATURE_HEADING = "WITNESS THE SIGNATURES OF THE PARTIES TO THIS RESIDENTIAL LEASE AGREEMENT";

export function SignatureBlock({
  participants,
  dividerLabel,
}: {
  participants: SignatureBlockParticipant[];
  // Lease doc labels its divider "END OF CONTRACT"; the lead-paint
  // disclosure doc just has a plain rule above the heading.
  dividerLabel?: string;
}) {
  const landlord = participants.filter((p) => p.role === "Landlord");
  const tenants = participants.filter((p) => p.role === "Tenant");
  const witnesses = participants.filter((p) => p.role !== "Landlord" && p.role !== "Tenant");

  function sigLine(name: string, key: string) {
    return (
      <View key={key} style={signatureStyles.sigLine}>
        <Text style={signatureStyles.sigLineLabel}>Sign:</Text>
        <View style={signatureStyles.sigLineBlank} />
        <Text style={signatureStyles.sigLineLabel}>Print: {name || "___________"}</Text>
        <Text style={signatureStyles.sigLineLabel}> Date:</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={signatureStyles.dividerRow}>
        <View style={signatureStyles.dividerLine} />
        {dividerLabel && (
          <>
            <Text style={signatureStyles.dividerLabel}>{dividerLabel}</Text>
            <View style={signatureStyles.dividerLine} />
          </>
        )}
      </View>
      <Text style={signatureStyles.sigHeading}>{SIGNATURE_HEADING}</Text>

      <Text style={signatureStyles.sigRoleHeading}>LANDLORD</Text>
      {landlord.length > 0
        ? landlord.map((p, i) => sigLine(p.name, `landlord-${i}`))
        : sigLine("", "landlord-0")}

      <Text style={signatureStyles.sigRoleHeading}>TENANT</Text>
      {tenants.length > 0 ? tenants.map((p, i) => sigLine(p.name, `tenant-${i}`)) : sigLine("", "tenant-0")}

      {witnesses.map((p, i) => (
        <View key={`witness-${i}`}>
          <Text style={signatureStyles.sigRoleHeading}>{p.role.toUpperCase()}</Text>
          {sigLine(p.name, `witness-line-${i}`)}
        </View>
      ))}
    </View>
  );
}
