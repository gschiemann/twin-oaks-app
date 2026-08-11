import { MailIcon, ReceiptIcon } from "@/components/Icons";
import { fileSrc } from "@/lib/storage";

export function receiptStatusTone(status: string): string {
  switch (status) {
    case "CATEGORIZED":
      return "green";
    case "INBOX":
      return "amber";
    case "NEEDS_REVIEW":
    case "TAX_UNCERTAIN":
      return "red";
    case "SPLIT_PERSONAL":
      return "blue";
    default:
      return "stone";
  }
}

export function ReceiptThumb({
  filePath,
  mimeType,
  source,
  size = "h-14 w-14",
}: {
  filePath: string | null;
  mimeType: string | null;
  source?: string | null;
  size?: string;
}) {
  if (filePath && mimeType?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fileSrc(filePath)}
        alt="Receipt"
        className={`${size} shrink-0 rounded-xl border border-stone-200 object-cover`}
      />
    );
  }
  // A forwarded email with no attachment: the message body IS the document.
  const isEmailBody = source === "EMAIL" && !mimeType?.startsWith("image/");
  return (
    <div
      className={`${size} flex shrink-0 items-center justify-center rounded-xl border ${
        isEmailBody ? "border-oak-200 bg-oak-50 text-oak-600" : "border-stone-200 bg-stone-50 text-stone-400"
      }`}
    >
      {isEmailBody ? <MailIcon className="h-6 w-6" /> : <ReceiptIcon className="h-6 w-6" />}
    </div>
  );
}
