import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAccountId } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
import { Card, PageHeader } from "@/components/ui";
import AssetForm from "../../AssetForm";
import { updateAsset } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const accountId = await requireAccountId();
  const { id } = await params;
  const [asset, profile] = await Promise.all([
    prisma.asset.findFirst({ where: { id, accountId } }),
    getBusinessProfile(accountId),
  ]);
  if (!asset) notFound();

  return (
    <div>
      <PageHeader title="Edit equipment" sub={asset.name} />
      <Card>
        <AssetForm action={updateAsset} submitLabel="Save changes" defaults={asset} divisions={profile.divisions} />
      </Card>
    </div>
  );
}
