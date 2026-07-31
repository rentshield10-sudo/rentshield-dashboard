import { supabaseServer } from "@/lib/supabase-server";
import { getCountyForCity } from "@/lib/nj-county-lookup";

const LANDLORD_NAME_DEFAULT = "ALMO Properties, LLC";
const GUEST_FINE_AMOUNT_DEFAULT = "50";
const GUEST_NOTICE_DAYS_DEFAULT = "3";

// Gets or creates the one persistent lease-template draft tied to a given
// apartment_lease_details row. On first creation, pre-fills whichever
// template variables Rentvine's data can actually answer (address, unit,
// tenant names, dates, rent, deposit, county) plus fixed company-policy
// defaults (landlord name, guest fine/notice-days) -- all left editable.
// On subsequent calls, the existing draft is returned untouched so it never
// clobbers staff edits to the fields Rentvine can't supply (occupants,
// personal property, pet info, additional provisions).
export async function getOrCreateDraftForApartment(apartmentLeaseDetailsId: number): Promise<number> {
  const { data: existingDraft, error: existingError } = await supabaseServer
    .from("lease_template_drafts")
    .select("id")
    .eq("apartment_lease_details_id", apartmentLeaseDetailsId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existingDraft) return existingDraft.id;

  const { data: row, error: rowError } = await supabaseServer
    .from("apartment_lease_details")
    .select(
      "address, unit, city, tenant_name, activation_1, expiration_1, activation_2, expiration_2, new_rent, current_rent, security_deposit",
    )
    .eq("id", apartmentLeaseDetailsId)
    .maybeSingle();
  if (rowError) throw rowError;
  if (!row) throw new Error("Apartment lease details row not found.");

  const { data: draft, error: draftError } = await supabaseServer
    .from("lease_template_drafts")
    .insert({ apartment_lease_details_id: apartmentLeaseDetailsId })
    .select("id")
    .single();
  if (draftError) throw draftError;

  const county = getCountyForCity(row.city);
  const values: Record<string, string> = {
    landlordName: LANDLORD_NAME_DEFAULT,
    guestFineAmount: GUEST_FINE_AMOUNT_DEFAULT,
    guestNoticeDays: GUEST_NOTICE_DAYS_DEFAULT,
  };
  if (row.tenant_name) values.tenantNames = row.tenant_name;
  if (row.address) values.propertyAddress = row.address;
  if (row.unit) values.unit = row.unit;
  if (county) values.county = county;
  const leaseStart = row.activation_2 || row.activation_1;
  if (leaseStart) values.leaseStart = leaseStart;
  const leaseEnd = row.expiration_2 || row.expiration_1;
  if (leaseEnd) values.leaseEnd = leaseEnd;
  if (row.security_deposit != null) values.securityDeposit = String(row.security_deposit);
  const rentAmount = row.new_rent ?? row.current_rent;
  if (rentAmount != null) values.rentAmount = String(rentAmount);

  const now = new Date().toISOString();
  const { error: valuesError } = await supabaseServer.from("lease_template_draft_values").insert(
    Object.entries(values).map(([variable_name, value]) => ({
      draft_id: draft.id,
      variable_name,
      value,
      updated_at: now,
    })),
  );
  if (valuesError) throw valuesError;

  return draft.id;
}
