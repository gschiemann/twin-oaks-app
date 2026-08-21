import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, FormError, PageHeader } from "@/components/ui";
import AssetForm from "../AssetForm";
import { createAsset } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewAssetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const accountId = await requireAccountId();
  const { error } = await searchParams;
  const profile = await getBusinessProfile(accountId);
  return (
    <div>
      <PageHeader
        title="Add equipment"
        sub="Tractor, printer, trailer, building — anything worth tracking gets a profile."
      />
      {error ? (
        <FormError>Give the equipment a Name, then tap Save equipment again.</FormError>
      ) : null}
      <Card>
        <AssetForm action={createAsset} submitLabel="Save equipment" divisions={profile.divisions} />
      </Card>
    </div>
  );
}
