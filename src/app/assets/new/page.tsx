import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import AssetForm from "../AssetForm";
import { createAsset } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewAssetPage() {
  const accountId = await requireAccountId();
  const profile = await getBusinessProfile(accountId);
  return (
    <div>
      <PageHeader
        title="Add equipment"
        sub="Tractor, printer, trailer, building — anything worth tracking gets a profile."
      />
      <Card>
        <AssetForm action={createAsset} submitLabel="Save equipment" divisions={profile.divisions} />
      </Card>
    </div>
  );
}
